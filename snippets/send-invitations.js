// Send blank connection requests (Endpoints 1 + 5). SENDS REAL INVITATIONS.
// Only run after the user explicitly authorized this exact batch.
// Each person gets a fresh relationship check right before the send; only an explicit
// `noInvitation` state is sent. Max 20 per call, >= 3 s between sends.
// outcome: verified_send | already_connected | already_pending | skipped_unknown |
//          identity_mismatch | lookup_error | send_failed | cant_resend_yet | ambiguous_send | hard_stop
async () => {
  const INPUT = { slugs: ['jane-doe-123'], delayMs: 3000, maxSends: 20 };

  const delayMs = Math.max(3000, Number(INPUT.delayMs) || 3000);
  const maxSends = Math.min(20, Number(INPUT.maxSends) || 20);
  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', results: [] };
  const headers = {
    'csrf-token': token, 'x-restli-protocol-version': '2.0.0',
    accept: 'application/vnd.linkedin.normalized+json+2.1', 'x-li-lang': 'en_US'
  };
  const norm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const toSlug = s => {
    const m = String(s).match(/linkedin\.com\/in\/([^/?#]+)/i);
    return decodeURIComponent(m ? m[1] : String(s)).replace(/\/$/, '').trim();
  };
  const results = [];
  let sends = 0;
  for (const raw of INPUT.slugs) {
    if (sends >= maxSends) break;
    const slug = toSlug(raw);
    const push = (o) => { const r = { slug, ...o, at: new Date().toISOString() }; results.push(r); return r; };
    let lookup;
    try {
      lookup = await fetch(
        'https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity='
          + encodeURIComponent(slug)
          + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-15',
        { headers, credentials: 'include' }
      );
    } catch { push({ outcome: 'lookup_error', reason: 'network_error' }); continue; }
    if (lookup.status === 401 || lookup.status === 429) {
      push({ outcome: 'hard_stop', reason: `lookup_http_${lookup.status}` });
      return { hardStop: `http_${lookup.status}`, sends, results };
    }
    if (!lookup.ok) { push({ outcome: 'lookup_error', reason: `lookup_http_${lookup.status}` }); await new Promise(r => setTimeout(r, 1000)); continue; }
    let body;
    try { body = await lookup.json(); } catch { push({ outcome: 'skipped_unknown', reason: 'lookup_malformed' }); continue; }
    const included = body?.included || [];
    const profileUrn = body?.data?.['*elements']?.[0] || null;
    const el = included.find(i => i.entityUrn === profileUrn);
    const name = el ? `${el.firstName || ''} ${el.lastName || ''}`.trim() : null;
    const union = included.find(i => i.entityUrn === el?.['*memberRelationship'])?.memberRelationshipUnion || null;
    if (!profileUrn || !el || !union) { push({ outcome: 'skipped_unknown', reason: 'incomplete_response', name }); continue; }
    if (norm(el.publicIdentifier) !== norm(slug)) {
      push({ outcome: 'identity_mismatch', name, publicIdentifier: el.publicIdentifier || null, profileUrn }); continue;
    }
    if ('*connection' in union || 'connection' in union) { push({ outcome: 'already_connected', name, profileUrn }); continue; }
    const inv = union.noConnection?.invitationUnion || null;
    const invitationUrn = inv?.['*invitation'] || null;
    const invitation = invitationUrn ? included.find(i => i.entityUrn === invitationUrn) : null;
    if (invitation?.invitationType === 'SENT') { push({ outcome: 'already_pending', name, profileUrn, invitationUrn }); continue; }
    if (!inv || !('noInvitation' in inv)) { push({ outcome: 'skipped_unknown', reason: 'invitation_state_unresolved', name, profileUrn }); continue; }

    const elapsed = Date.now() - (window.__liLastSendAt || 0);
    if (elapsed < delayMs) await new Promise(r => setTimeout(r, delayMs - elapsed));
    window.__liLastSendAt = Date.now();
    let sent;
    try {
      sent = await fetch('https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreate', {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        credentials: 'include', body: JSON.stringify({ inviteeProfileUrn: profileUrn })
      });
    } catch {
      // The request may have reached LinkedIn. Do not resend; recheck this person later.
      push({ outcome: 'ambiguous_send', reason: 'send_network_error', name, profileUrn });
      return { hardStop: 'ambiguous_send', sends, results };
    }
    let sentBody = null;
    try { sentBody = await sent.json(); } catch {}
    const receipt = sentBody?.data?.value?.invitationUrn || sentBody?.value?.invitationUrn || null;
    const code = sentBody?.code || sentBody?.data?.code || null;
    if (sent.status === 200 && receipt) { sends += 1; push({ outcome: 'verified_send', name, profileUrn, invitationUrn: receipt }); continue; }
    if (code === 'CANT_RESEND_YET') { push({ outcome: 'cant_resend_yet', name, profileUrn, httpStatus: sent.status }); continue; }
    if ([401, 403, 429].includes(sent.status)) {
      push({ outcome: 'hard_stop', reason: `send_http_${sent.status}`, name, profileUrn });
      return { hardStop: `http_${sent.status}`, sends, results };
    }
    if (sent.status === 200) {
      // 200 without a receipt: parser drift or silent failure. Stop and inspect before sending more.
      push({ outcome: 'ambiguous_send', reason: 'http_200_without_receipt', name, profileUrn, responseKeys: Object.keys(sentBody || {}) });
      return { hardStop: 'ambiguous_send', sends, results };
    }
    push({ outcome: 'send_failed', reason: `send_http_${sent.status}`, code, name, profileUrn });
  }
  return { hardStop: null, sends, results };
}
