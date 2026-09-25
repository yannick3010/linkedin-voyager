// People or company search (Endpoints 3 and 4). Read-only.
// type: 'PEOPLE' | 'COMPANIES'. companyId: optional currentCompany filter for PEOPLE.
async () => {
  const INPUT = { type: 'PEOPLE', keywords: 'Jane Doe Example Co', companyId: null, count: 10, start: 0 };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', results: [] };
  const kw = encodeURIComponent(INPUT.keywords).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const filters = [`(key:resultType,value:List(${INPUT.type}))`];
  if (INPUT.type === 'PEOPLE' && INPUT.companyId) filters.push(`(key:currentCompany,value:List(${INPUT.companyId}))`);
  const origin = INPUT.type === 'PEOPLE' ? 'FACETED_SEARCH' : 'SWITCH_SEARCH_VERTICAL';
  const variables = `(start:${INPUT.start},origin:${origin},query:(keywords:${kw},flagshipSearchIntent:SEARCH_SRP,queryParameters:List(${filters.join(',')}),includeFiltersInResponse:false),count:${INPUT.count})`;
  const r = await fetch(
    `https://www.linkedin.com/voyager/api/graphql?variables=${variables}&queryId=voyagerSearchDashClusters.b0928897b71bd00a5a7291755dcd64f0`,
    { headers: { 'csrf-token': token, 'x-restli-protocol-version': '2.0.0' }, credentials: 'include' }
  );
  if (!r.ok) return { hardStop: r.status === 429 ? 'http_429' : null, error: `http_${r.status}`, results: [] };
  const data = await r.json();
  const clusters = data?.data?.searchDashClustersByAll?.elements || [];
  const results = [];
  const pushEntity = e => {
    if (!e) return;
    const companyId = e.entityUrn?.match(/fsd_company:(\d+)/)?.[1] || null;
    const profileId = e.entityUrn?.match(/fsd_profile:([^,)]+)/)?.[1] || null;
    results.push({
      name: e.title?.text || null,
      subtitle: e.primarySubtitle?.text || null,
      location: e.secondarySubtitle?.text || null,
      url: e.navigationUrl ? e.navigationUrl.split('?')[0] : null,
      degree: e.badgeText?.text || e.badgeText || null,
      profileUrn: profileId ? `urn:li:fsd_profile:${profileId}` : null,
      companyId
    });
  };
  clusters.forEach(c => (c.items || []).forEach(item => pushEntity(item?.item?.entityResult)));
  if (!results.length && Array.isArray(data?.included)) {
    // Normalized-shape fallback
    data.included.filter(i => String(i.$type || '').endsWith('EntityResultViewModel')).forEach(pushEntity);
  }
  return { hardStop: null, results };
}
