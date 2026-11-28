// src/utils/matchmaker.js

// 【選誰上場】只記憶最近 2 場，避開短期重複，且絕不讓遲到者因為整晚重疊度低而狂追場次
const RECENT_MATCH_WINDOW = 2;

// 【決定隊友】翻閱「整晚所有歷史紀錄」，確保每個人都能跟所有隊友 (C7取1) 輪流搭檔
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

// 計算四個人裡面，任意兩人在「最近 2 場」中同場打球過幾次（含同隊與對手）
function getGroupOverlapCost(fourPlayers, historyList) {
  const recentHistory = (historyList || []).slice(-RECENT_MATCH_WINDOW);
  let totalOverlap = 0;
  for (let i = 0; i < fourPlayers.length; i++) {
    for (let j = i + 1; j < fourPlayers.length; j++) {
      const id1 = fourPlayers[i].id;
      const id2 = fourPlayers[j].id;
      for (const h of recentHistory) {
        const allIds = [...(h.teamAIds || []), ...(h.teamBIds || [])];
        if (allIds.includes(id1) && allIds.includes(id2)) {
          totalOverlap++;
        }
      }
    }
  }
  return totalOverlap;
}

// 決定這 4 個人要怎麼分成 A、B 兩隊：
// 優先挑選「整晚最少當過隊友」的拆法；若次數相同則完全隨機（自動產生同隊與不同隊的變化）
export function divideIntoBestTeams(fourPlayers, historyList) {
  const [p1, p2, p3, p4] = fourPlayers;
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

  configurations.sort((a, b) => (a.cost - b.cost) || (Math.random() - 0.5));
  return {
    teamA: configurations[0].teamA,
    teamB: configurations[0].teamB
  };
}

// 輔助函式：產生所有「N 取 k」的組合
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

  // 1. 【硬性規則：不連打超過 2 場】只有 5 人時物理上必須連打 4 場，6 人以上連打滿 2 場強制下場
  const maxConsecutivePlay = N === 5 ? 4 : 2;
  const eligiblePlayers = playerPool.filter(p => (p.consecutivePlay || 0) < maxConsecutivePlay);
  const candidatePool = eligiblePlayers.length >= 4 ? eligiblePlayers : playerPool;

  // 2. 【硬性規則：不連休超過 2 場】連休 >= 2 場的人直接保送進入必選名單
  let mustPlay = candidatePool.filter(p => (p.consecutiveRest || 0) >= 2);
  let remainingPool = candidatePool.filter(p => (p.consecutiveRest || 0) < 2);

  // 若人數 >= 13 人導致超過 4 人連休 2 場，優先讓休最久的人上場
  if (mustPlay.length >= 4) {
    mustPlay.sort((a, b) => (b.consecutiveRest || 0) - (a.consecutiveRest || 0) || (Math.random() - 0.5));
    return divideIntoBestTeams(mustPlay.slice(0, 4), matchHistory);
  }

  // 3. 產生所有合法的 4 人組合
  const needed = 4 - mustPlay.length;
  const combs = getCombinations(remainingPool, needed);
  let possibleFourGroups = combs.map(c => [...mustPlay, ...c]);

  // 4. 【打破 8 人 4上4下】人數剛好 8 人時，強制每場必須是「2個上一場打過 + 2個上一場沒打」
  if (N === 8) {
    const mixedGroups = possibleFourGroups.filter(group => {
      const playedLastCount = group.filter(p => (p.consecutivePlay || 0) > 0).length;
      return playedLastCount === 2;
    });
    if (mixedGroups.length > 0) {
      possibleFourGroups = mixedGroups;
    }
  }

  // 5. 挑選「最近 2 場最少碰頭」的 4 人組合；重疊度相同時完全隨機
  possibleFourGroups.sort((a, b) => {
    const costA = getGroupOverlapCost(a, matchHistory);
    const costB = getGroupOverlapCost(b, matchHistory);
    return (costA - costB) || (Math.random() - 0.5);
  });

  const bestFour = possibleFourGroups[0];
  return divideIntoBestTeams(bestFour, matchHistory);
}

export function generateUpcomingMatch(currentMatchSelection, allPlayers, matchHistory) {
  const activePlayers = (allPlayers || []).filter(p => p.status === 'active');
  if (activePlayers.length < 4) return null;

  const currentIds = [...currentMatchSelection.teamA, ...currentMatchSelection.teamB];
  const simulatedPlayers = activePlayers.map(p => {
    const copy = { ...p };
    if (currentIds.includes(copy.id)) {
      copy.played = (copy.played || 0) + 1;
      copy.consecutivePlay = (copy.consecutivePlay || 0) + 1;
      copy.consecutiveRest = 0;
    } else {
      copy.consecutivePlay = 0;
      copy.consecutiveRest = (copy.consecutiveRest || 0) + 1;
    }
    return copy;
  });

  return pickFourPlayers(simulatedPlayers, matchHistory);
}