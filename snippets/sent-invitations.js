// List every active outbound connection invitation (Endpoint 7). Read-only.
// Membership = still pending. Absence does NOT prove acceptance; verify with check-profiles.js.
async () => {
  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', invitations: [] };
  const headers = { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0' };
  const all = [];
  const count = 100;
  for (let start = 0; start < 5000; start += count) {
    const r = await fetch(
      `https://www.linkedin.com/voyager/api/voyagerRelationshipsDashSentInvitationViews?count=${count}&q=invitationType&invitationType=CONNECTION&start=${start}`,
      { headers, credentials: 'include' }
    );
    if (!r.ok) return { hardStop: `http_${r.status}`, complete: false, invitations: all };
    const j = await r.json();
    const els = j.elements || j.data?.elements || [];
    for (const e of els) {
      const slug = e.cardActionTarget?.split('/in/')[1]?.replace(/\/$/, '') || null;
      all.push({ name: e.title?.text || null, headline: e.subtitle?.text || null, slug,
        sentTimeLabel: e.sentTimeLabel || null, invitationUrn: e.invitationUrn || null });
    }
    if (els.length < count) return { hardStop: null, complete: true, total: all.length, invitations: all };
    await new Promise(res => setTimeout(res, 500));
  }
  return { hardStop: null, complete: false, reason: 'page_limit', total: all.length, invitations: all };
}
