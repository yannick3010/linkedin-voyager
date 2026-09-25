// Session check. Run before every batch.
// Returns the signed-in member. Never returns cookies or tokens.
async () => {
  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') {
    return { ok: false, reason: 'not_logged_in_or_wrong_tab', host: location.hostname };
  }
  const r = await fetch('https://www.linkedin.com/voyager/api/me', {
    headers: { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0' },
    credentials: 'include'
  });
  const j = r.ok ? await r.json() : null;
  const mini = j?.miniProfile || {};
  const id = mini.entityUrn ? mini.entityUrn.split(':').pop() : null;
  return {
    ok: r.ok,
    status: r.status,
    name: `${mini.firstName || ''} ${mini.lastName || ''}`.trim() || null,
    publicIdentifier: mini.publicIdentifier || null,
    profileUrn: id ? `urn:li:fsd_profile:${id}` : null
  };
}
