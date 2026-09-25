// Profile lookup + relationship state (Endpoint 1). Read-only.
// Edit INPUT.slugs (max ~40 per call). Accepts slugs or full /in/ URLs.
// status: connected | outbound_pending | not_connected | unknown | lookup_error | hard_stop
async () => {
  const INPUT = { slugs: ['jane-doe-123'], delayMs: 1500 };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', results: [] };
  const headers = {
    'csrf-token': token, 'x-restli-protocol-version': '2.0.0',
    accept: 'application/vnd.linkedin.normalized+json+2.1', 'x-li-lang': 'en_US'
  };
  const toSlug = s => {
    const m = String(s).match(/linkedin\.com\/in\/([^/?#]+)/i);
    return decodeURIComponent(m ? m[1] : String(s)).replace(/\/$/, '').trim();
  };
  const results = [];
  for (const raw of INPUT.slugs) {
    const slug = toSlug(raw);
    try {
      const resp = await fetch(
        'https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity='
          + encodeURIComponent(slug)
          + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-15',
        { headers, credentials: 'include' }
      );
      if (resp.status === 401 || resp.status === 429) {
        results.push({ slug, status: 'hard_stop', httpStatus: resp.status });
        return { hardStop: `http_${resp.status}`, results };
      }
      if (!resp.ok) { results.push({ slug, status: 'lookup_error', httpStatus: resp.status }); continue; }
      const data = await resp.json();
      const included = data?.included || [];
      const profileUrn = data?.data?.['*elements']?.[0] || null;
      const el = included.find(i => i.entityUrn === profileUrn);
      const mr = included.find(i => i.entityUrn === el?.['*memberRelationship']);
      const union = mr?.memberRelationshipUnion || null;
      const base = {
        slug, profileUrn,
        name: el ? `${el.firstName || ''} ${el.lastName || ''}`.trim() : null,
        headline: el?.headline || null,
        publicIdentifier: el?.publicIdentifier || null
      };
      if (!profileUrn || !el || !union) { results.push({ ...base, status: 'unknown', reason: 'incomplete_response' }); continue; }
      if ('*connection' in union || 'connection' in union) { results.push({ ...base, status: 'connected' }); continue; }
      const inv = union.noConnection?.invitationUnion || null;
      const invitationUrn = inv?.['*invitation'] || null;
      const invitation = invitationUrn ? included.find(i => i.entityUrn === invitationUrn) : null;
      if (invitation?.invitationType === 'SENT' && invitation?.invitationState === 'PENDING') {
        results.push({ ...base, status: 'outbound_pending', invitationUrn }); continue;
      }
      if (inv && 'noInvitation' in inv) { results.push({ ...base, status: 'not_connected' }); continue; }
      results.push({ ...base, status: 'unknown', reason: 'invitation_state_unresolved', invitationUrn,
        invitationType: invitation?.invitationType || null, invitationState: invitation?.invitationState || null });
    } catch (e) {
      results.push({ slug, status: 'lookup_error', msg: String(e?.message || e) });
    }
    await new Promise(r => setTimeout(r, INPUT.delayMs));
  }
  return { hardStop: null, results };
}
