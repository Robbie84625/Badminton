// src/utils/matchmaker.js

function extractMatchPlayerIds(match) {
  if (!match) return [];
  const rawList = [
    ...(match.teamAIds || []),
    ...(match.teamBIds || []),
    ...(match.teamA || []),
    ...(match.teamB || []),
    ...(match.players || [])
  ];
  return rawList.map(p => (typeof p === 'object' && p !== null ? (p.id ?? p.name) : p));
}

function trueShuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function syncRealConsecutiveStats(playerPool, matchHistory) {
  const history = matchHistory || [];
  return playerPool.map(p => {
    const pid = p.id ?? p.name;
    let realCPlay = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const ids = extractMatchPlayerIds(history[i]);
      if (ids.includes(pid)) {
        realCPlay++;
      } else {
        break;
      }
    }

    return {
      ...p,
      consecutivePlay: realCPlay,
      consecutiveRest: p._simulatedCRest !== undefined ? p._simulatedCRest : (p.consecutiveRest || 0)
    };
  });
}

export function getPairHistoryCount(p1Id, p2Id, historyList) {
  let count = 0;
  for (const h of (historyList || [])) {
    if (!h.teamAIds || !h.teamBIds) continue;
    const inA = h.teamAIds.includes(p1Id) && h.teamAIds.includes(p2Id);
    const inB = h.teamBIds.includes(p1Id) && h.teamBIds.includes(p2Id);
    if (inA || inB) count++;
  }
  return count;
}

function getGroupOverlapCost(fourPlayers, historyList) {
  // 只看「上一場 (slice(-1))」，避免剛從休息/遲到回來的人因為前 2 場成本為 0 而連續被抓上場
  const lastMatch = (historyList || []).slice(-1)[0];
  if (!lastMatch) return 0;

  const lastIds = extractMatchPlayerIds(lastMatch);
  let totalCost = 0;

  for (let i = 0; i < fourPlayers.length; i++) {
    for (let j = i + 1; j < fourPlayers.length; j++) {
      const id1 = fourPlayers[i].id;
      const id2 = fourPlayers[j].id;
      // 如果這兩個人「上一場」才剛一起打過球，這場盡量把他們拆開
      if (lastIds.includes(id1) && lastIds.includes(id2)) {
        totalCost += 3;
      }
    }
  }
  return totalCost;
}

export function divideIntoBestTeams(fourPlayers, historyList) {
  const [p1, p2, p3, p4] = trueShuffle(fourPlayers);
  const configurations = [
    {
      teamA: [p1.id, p2.id],
      teamB: [p3.id, p4.id],
      cost: getPairHistoryCount(p1.id, p2.id, historyList) + getPairHistoryCount(p3.id, p4.id, historyList)
    },
    {
      teamA: [p1.id, p3.id],
      teamB: [p2.id, p4.id],
      cost: getPairHistoryCount(p1.id, p3.id, historyList) + getPairHistoryCount(p2.id, p4.id, historyList)
    },
    {
      teamA: [p1.id, p4.id],
      teamB: [p2.id, p3.id],
      cost: getPairHistoryCount(p1.id, p4.id, historyList) + getPairHistoryCount(p2.id, p3.id, historyList)
    }
  ];

  configurations.sort((a, b) => a.cost - b.cost);
  return {
    teamA: configurations[0].teamA,
    teamB: configurations[0].teamB
  };
}

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [first, ...rest] = arr;
  const withFirst = getCombinations(rest, k - 1).map(comb => [first, ...comb]);
  const withoutFirst = getCombinations(rest, k);
  return [...withFirst, ...withoutFirst];
}

export function pickFourPlayers(playerPool, matchHistory) {
  const N = playerPool.length;
  if (N < 4) return null;
  if (N === 4) return divideIntoBestTeams(playerPool, matchHistory);

  const shuffledInput = trueShuffle(playerPool);
  const syncedPool = syncRealConsecutiveStats(shuffledInput, matchHistory);

  // 1. 【硬性規則：不連打超過 2 場】
  const maxConsecutivePlay = N === 5 ? 4 : 2;
  const eligiblePlayers = syncedPool.filter(p => p.consecutivePlay < maxConsecutivePlay);
  const candidatePool = eligiblePlayers.length >= 4 ? eligiblePlayers : syncedPool;

  // 2. 【硬性規則：不連休超過 2 場】
  let mustPlay = candidatePool.filter(p => p.consecutiveRest >= 2);
  let remainingPool = candidatePool.filter(p => p.consecutiveRest < 2);

  if (mustPlay.length >= 4) {
    return divideIntoBestTeams(trueShuffle(mustPlay).slice(0, 4), matchHistory);
  }

  // 3. 產生所有合法的 4 人組合
  const needed = 4 - mustPlay.length;
  const combs = getCombinations(remainingPool, needed);
  let possibleFourGroups = combs.map(c => [...mustPlay, ...c]);

  // 4. 【打破 8 人 4上4下 且 打破雙胞胎綁定】
  // 只要不讓 4 個人「全部上一場都打過（4上）」或「全部上一場都沒打（4下）」即可！
  // 允許「1上3下」、「2上2下」、「3上1下」，這樣雙胞胎才能被拆開（1人留下、1人下場）！
  if (N === 8) {
    const mixedGroups = possibleFourGroups.filter(group => {
      const playedLastCount = group.filter(p => p.consecutivePlay > 0).length;
      return playedLastCount >= 1 && playedLastCount <= 3;
    });
    if (mixedGroups.length > 0) {
      possibleFourGroups = mixedGroups;
    }
  }

  // 5. 先洗牌再排序：重罰「最近 2 場同場打過球的人」，強迫上一場一起打的 7、8 號這場必須拆開！
  const shuffledGroups = trueShuffle(possibleFourGroups);
  shuffledGroups.sort((a, b) => getGroupOverlapCost(a, matchHistory) - getGroupOverlapCost(b, matchHistory));

  const bestFour = shuffledGroups[0];
  return divideIntoBestTeams(bestFour, matchHistory);
}

export function generateUpcomingMatch(currentMatchSelection, allPlayers, matchHistory) {
  const activePlayers = (allPlayers || []).filter(p => p.status === 'active');
  if (activePlayers.length < 4) return null;

  const rawCurrent = [
    ...(currentMatchSelection?.teamA || []),
    ...(currentMatchSelection?.teamB || []),
    ...(currentMatchSelection?.teamAIds || []),
    ...(currentMatchSelection?.teamBIds || [])
  ];
  const currentIds = rawCurrent.map(p => (typeof p === 'object' && p !== null ? (p.id ?? p.name) : p));

  const simulatedPlayers = activePlayers.map(p => ({
    ...p,
    _simulatedCRest: currentIds.includes(p.id) ? 0 : (p.consecutiveRest || 0) + 1
  }));

  const simulatedHistory = [
    ...(matchHistory || []),
    { teamAIds: currentIds.slice(0, 2), teamBIds: currentIds.slice(2, 4) }
  ];

  return pickFourPlayers(simulatedPlayers, simulatedHistory);
}