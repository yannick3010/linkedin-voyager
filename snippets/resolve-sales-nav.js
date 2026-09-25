// Resolve Sales Navigator lead URLs to canonical /in/ profile URLs (Endpoint 3a). Read-only.
// Requires a Sales Navigator seat.
async () => {
  const INPUT = { urls: ['https://www.linkedin.com/sales/lead/REPLACE_ME,NAME_SEARCH,abcd'] };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', results: [] };
  const decoration = '%28entityUrn%2CobjectUrn%2CfirstName%2ClastName%2CfullName%2Cheadline%2CpendingInvitation%2CflagshipProfileUrl%29';
  const results = [];
  for (const url of INPUT.urls) {
    const m = String(url).match(/\/sales\/lead\/([^,/?#]+)/);
    const id = m ? decodeURIComponent(m[1]) : null;
    if (!id) { results.push({ url, status: 'invalid_url' }); continue; }
    const r = await fetch(`https://www.linkedin.com/sales-api/salesApiProfiles/(profileId:${id},authType:undefined,authToken:undefined)?decoration=${decoration}`,
      { headers: { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0' }, credentials: 'include' });
    if (r.status === 401 || r.status === 429) { results.push({ url, status: 'hard_stop', httpStatus: r.status }); return { hardStop: `http_${r.status}`, results }; }
    if (!r.ok) { results.push({ url, status: 'lookup_error', httpStatus: r.status }); continue; }
    const j = await r.json();
    const flagship = j.flagshipProfileUrl || null;
    const slug = flagship?.match(/linkedin\.com\/in\/([^/?#]+)/)?.[1] || null;
    const idMatches = String(j.entityUrn || '').startsWith(`urn:li:fs_salesProfile:(${id},`);
    results.push(idMatches && slug
      ? { url, status: 'resolved', name: j.fullName || null, headline: j.headline || null, slug, profileUrl: `https://www.linkedin.com/in/${slug}` }
      : { url, status: 'unresolved', reason: idMatches ? 'no_flagship_url' : 'id_mismatch' });
    await new Promise(res => setTimeout(res, 500));
  }
  return { hardStop: null, results };
}
