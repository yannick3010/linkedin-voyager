// Withdraw pending invitations (Endpoint 8). DESTRUCTIVE: puts each person in LinkedIn's resend cooldown.
// Only run after the user explicitly authorized this exact list. ~50 per call max.
async () => {
  const INPUT = { invitationUrns: ['urn:li:fsd_invitation:0000000000000000000'] };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', results: [] };
  const headers = { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0', 'content-type': 'application/json' };
  const results = [];
  for (const urn of INPUT.invitationUrns.slice(0, 50)) {
    const id = String(urn).split(':').pop();
    try {
      const r = await fetch(`https://www.linkedin.com/voyager/api/relationships/invitations/${id}?action=withdraw`,
        { method: 'POST', headers, credentials: 'include', body: '{}' });
      results.push({ invitationUrn: urn, ok: r.ok, status: r.status });
      if (r.status === 401 || r.status === 429) return { hardStop: `http_${r.status}`, results };
    } catch (e) {
      results.push({ invitationUrn: urn, ok: false, error: String(e?.message || e) });
    }
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1500));
  }
  return { hardStop: null, results };
}
