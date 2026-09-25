// Walk the messaging inbox (Endpoint 9). Read-only.
// Set INPUT.myProfileUrn from me.js. Optional INPUT.profileUrns limits output to threads with those people.
// queryIds rotate; if this returns http_400, harvest a fresh one (see docs/voyager-api.md, Endpoint 9).
async () => {
  const INPUT = {
    myProfileUrn: 'urn:li:fsd_profile:REPLACE_ME',
    profileUrns: [],          // optional filter: ['urn:li:fsd_profile:...']
    sinceDays: 180,           // stop walking once threads are older than this
    maxPages: 30,
    queryId: 'messengerConversations.9501074288a12f3ae9e3c7ea243bccbf'
  };

  const csrf = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith('JSESSIONID='));
  const token = csrf ? csrf.split('=')[1].replace(/"/g, '') : null;
  if (!token || location.hostname !== 'www.linkedin.com') return { hardStop: 'session_failure', threads: [] };
  const headers = {
    'csrf-token': token, 'x-restli-protocol-version': '2.0.0',
    accept: 'application/vnd.linkedin.normalized+json+2.1'
  };
  const enc = s => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29');
  const idOf = urn => String(urn || '').match(/fsd_profile:([^,)\s]+)/)?.[1] || null;
  const myId = idOf(INPUT.myProfileUrn);
  const filter = new Set(INPUT.profileUrns.map(idOf).filter(Boolean));
  const floor = Date.now() - INPUT.sinceDays * 86400000;
  const threads = [];
  let cursor = null, pages = 0, stopReason = 'end_of_inbox';
  while (pages < INPUT.maxPages) {
    const vars = `(query:(predicateUnions:List((conversationCategoryPredicate:(category:PRIMARY_INBOX)))),count:20,mailboxUrn:${enc(INPUT.myProfileUrn)}${cursor ? `,nextCursor:${enc(cursor)}` : ''})`;
    const r = await fetch(`https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql?queryId=${INPUT.queryId}&variables=${vars}`,
      { headers, credentials: 'include' });
    if (!r.ok) return { hardStop: `http_${r.status}`, pages, threads };
    const text = await r.text();
    const j = JSON.parse(text);
    const inc = j.included || [];
    const convos = inc.filter(i => String(i.$type || '').endsWith('.Conversation'));
    const participants = inc.filter(i => String(i.$type || '').endsWith('.MessagingParticipant'));
    const messages = inc.filter(i => String(i.$type || '').endsWith('.Message'));
    let oldest = Infinity;
    for (const c of convos) {
      oldest = Math.min(oldest, c.lastActivityAt || 0);
      const others = (c['*conversationParticipants'] || []).map(idOf).filter(id => id && id !== myId);
      if (filter.size && !others.some(id => filter.has(id))) continue;
      const last = messages.filter(m => m['*conversation'] === c.entityUrn).sort((a, b) => (b.deliveredAt || 0) - (a.deliveredAt || 0))[0];
      const lastSenderId = idOf(last?.['*sender']);
      const names = others.map(id => {
        const p = participants.find(x => idOf(x.hostIdentityUrn) === id);
        const m = p?.participantType?.member;
        return m ? `${m.firstName?.text || ''} ${m.lastName?.text || ''}`.trim() : null;
      });
      threads.push({
        conversationUrn: c.entityUrn,
        participants: others.map((id, k) => ({ profileUrn: `urn:li:fsd_profile:${id}`, name: names[k] })),
        lastActivityAt: c.lastActivityAt ? new Date(c.lastActivityAt).toISOString() : null,
        unreadCount: c.unreadCount ?? null,
        lastMessageFrom: !lastSenderId ? null : lastSenderId === myId ? 'me' : 'them',
        lastMessagePreview: last?.body?.text ? last.body.text.slice(0, 140) : null
      });
    }
    pages += 1;
    const next = text.match(/"nextCursor":"([^"]+)"/)?.[1] || null;
    if (oldest < floor) { stopReason = 'date_floor'; break; }
    if (!next || next === cursor) { stopReason = 'end_of_inbox'; break; }
    cursor = next;
    if (pages >= INPUT.maxPages) { stopReason = 'page_limit'; break; }
    await new Promise(res => setTimeout(res, 500));
  }
  return { hardStop: null, pages, stopReason, threads };
}
