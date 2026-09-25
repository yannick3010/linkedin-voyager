// Read messages in one conversation (Endpoint 9). Read-only.
// Set INPUT.conversationUrn from inbox.js output.
async () => {
  const INPUT = {
    conversationUrn: 'urn:li:msg_conversation:(urn:li:fsd_profile:REPLACE_ME,2-REPLACE_ME)',
    queryId: 'messengerMessages.5846eeb71c981f11e0134cb6626cc314'
  };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', messages: [] };
  const enc = s => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const r = await fetch(
    `https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${INPUT.queryId}&variables=(conversationUrn:${enc(INPUT.conversationUrn)})`,
    { headers: { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0', accept: 'application/vnd.linkedin.normalized+json+2.1' }, credentials: 'include' }
  );
  if (!r.ok) return { hardStop: `http_${r.status}`, messages: [] };
  const j = await r.json();
  const inc = j.included || [];
  const idOf = urn => String(urn || '').match(/fsd_profile:([^,)\s]+)/)?.[1] || null;
  const messages = inc.filter(i => String(i.$type || '').endsWith('.Message'))
    .map(m => ({ senderProfileUrn: idOf(m['*sender']) ? `urn:li:fsd_profile:${idOf(m['*sender'])}` : null,
      deliveredAt: m.deliveredAt ? new Date(m.deliveredAt).toISOString() : null, text: m.body?.text || '' }))
    .sort((a, b) => String(a.deliveredAt).localeCompare(String(b.deliveredAt)));
  return { hardStop: null, messages };
}
