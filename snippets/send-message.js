// Send one direct message (Endpoint 10). SENDS A REAL MESSAGE.
// Only run after the user approved this exact text for this exact recipient.
// Recipient must be a 1st-degree connection; this re-verifies that before sending.
async () => {
  const INPUT = {
    myProfileUrn: 'urn:li:fsd_profile:REPLACE_ME',   // from me.js
    recipientSlug: 'jane-doe-123',
    text: 'REPLACE_ME'
  };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { outcome: 'hard_stop', reason: 'session_failure' };
  if (!INPUT.text || INPUT.text === 'REPLACE_ME' || String(INPUT.myProfileUrn).includes('REPLACE_ME')) {
    return { outcome: 'not_sent', reason: 'input_not_filled' };
  }
  const headers = {
    'csrf-token': token, 'x-restli-protocol-version': '2.0.0',
    accept: 'application/vnd.linkedin.normalized+json+2.1', 'x-li-lang': 'en_US'
  };
  const lookup = await fetch(
    'https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity='
      + encodeURIComponent(INPUT.recipientSlug)
      + '&decorationId=com.linkedin.voyager.dash.deco.identity.profile.WebTopCardCore-15',
    { headers, credentials: 'include' }
  );
  if (!lookup.ok) return { outcome: lookup.status === 429 ? 'hard_stop' : 'not_sent', reason: `lookup_http_${lookup.status}` };
  const data = await lookup.json();
  const included = data?.included || [];
  const recipientUrn = data?.data?.['*elements']?.[0] || null;
  const el = included.find(i => i.entityUrn === recipientUrn);
  const union = included.find(i => i.entityUrn === el?.['*memberRelationship'])?.memberRelationshipUnion || {};
  const name = el ? `${el.firstName || ''} ${el.lastName || ''}`.trim() : null;
  if (!recipientUrn || !('*connection' in union || 'connection' in union)) {
    return { outcome: 'not_sent', reason: 'not_first_degree', name };
  }
  const r = await fetch('https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      message: { body: { attributes: [], text: INPUT.text }, originToken: crypto.randomUUID(), renderContentUnions: [] },
      mailboxUrn: INPUT.myProfileUrn,
      trackingId: String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
      dedupeByClientGeneratedToken: false,
      hostRecipientUrns: [recipientUrn]
    })
  });
  let body = null;
  try { body = await r.json(); } catch {}
  const messageUrn = body?.data?.value?.entityUrn || body?.value?.entityUrn || null;
  if (r.ok) return { outcome: 'sent', httpStatus: r.status, name, recipientUrn, messageUrn, at: new Date().toISOString() };
  return { outcome: [401, 403, 429].includes(r.status) ? 'hard_stop' : 'send_failed', httpStatus: r.status, name };
}
