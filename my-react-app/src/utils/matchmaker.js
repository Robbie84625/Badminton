// src/utils/matchmaker.js

// 計算兩個人在歷史紀錄中「同隊」過幾次 (C7取1 的概念)
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

// 計算四個人裡面，任意兩人在歷史紀錄中「同場打球」過幾次 (包含同隊與對手 C7取2)
function getGroupOverlapCost(fourPlayers, historyList) {
  let totalOverlap = 0;
  for (let i = 0; i < fourPlayers.length; i++) {
    for (let j = i + 1; j < fourPlayers.length; j++) {
      const id1 = fourPlayers[i].id;
      const id2 = fourPlayers[j].id;
      for (const h of (historyList || [])) {
        const allIds = [...(h.teamAIds || []), ...(h.teamBIds || [])];
        if (allIds.includes(id1) && allIds.includes(id2)) {
          totalOverlap++;
        }
      }
    }
  }
  return totalOverlap;
}

// 決定這 4 個人要怎麼分成 A、B 兩隊（挑過去最少當過隊友的拆法）
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

  // 優先選同隊次數最少的；若次數相同則完全隨機
  configurations.sort((a, b) => (a.cost - b.cost) || (Math.random() - 0.5));
  return {
    teamA: configurations[0].teamA,
    teamB: configurations[0].teamB
  };
}

// 輔助函式：從陣列中產生所有「取 k 個」的組合 (例如 C7取2)
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

  // 1. 【硬性規則】最多連打 2 場 (只有 5 人時允許連打 4 場)
  const maxConsecutivePlay = N === 5 ? 4 : 2;
  const eligiblePlayers = playerPool.filter(p => (p.consecutivePlay || 0) < maxConsecutivePlay);

  // 防呆：萬一合法名單不足 4 人，放寬標準補人
  const candidatePool = eligiblePlayers.length >= 4 ? eligiblePlayers : playerPool;

  // 2. 【硬性規則】最多連休 2 場 -> 已經連休 >= 2 場的人，直接進入「必選名單」
  let mustPlay = candidatePool.filter(p => (p.consecutiveRest || 0) >= 2);
  let remainingPool = candidatePool.filter(p => (p.consecutiveRest || 0) < 2);

  // 如果必選名單已經超過 4 人（例如 13 人以上時發生），優先挑休最久的
  if (mustPlay.length >= 4) {
    mustPlay.sort((a, b) => (b.consecutiveRest || 0) - (a.consecutiveRest || 0) || (Math.random() - 0.5));
    return divideIntoBestTeams(mustPlay.slice(0, 4), matchHistory);
  }

  let possibleFourGroups = [];

  // 3. 【打破 8 人 4上4下】如果剛好 8 人且無人連休 2 場，強制「2上2下」洗牌
  if (N === 8 && mustPlay.length === 0) {
    const restedOne = remainingPool.filter(p => (p.consecutiveRest || 0) === 1);
    const playedOne = remainingPool.filter(p => (p.consecutivePlay || 0) === 1);

    if (restedOne.length >= 2 && playedOne.length >= 2) {
      const restCombs = getCombinations(restedOne, 2);
      const playCombs = getCombinations(playedOne, 2);
      for (const rc of restCombs) {
        for (const pc of playCombs) {
          possibleFourGroups.push([...rc, ...pc]);
        }
      }
    }
  }

  // 一般情況（非 8 人強制洗牌，或上面沒湊出組合）：從剩餘名單中挑出缺少的人數 (C N 取 K)
  if (possibleFourGroups.length === 0) {
    const needed = 4 - mustPlay.length;
    const combs = getCombinations(remainingPool, needed);
    possibleFourGroups = combs.map(c => [...mustPlay, ...c]);
  }

  // 4. 【組合新鮮度】在所有合法的 4 人組合中，挑出「這 4 個人過去最少碰頭」的組合
  possibleFourGroups.sort((a, b) => {
    const costA = getGroupOverlapCost(a, matchHistory);
    const costB = getGroupOverlapCost(b, matchHistory);
    // 優先選最少重疊的；如果重疊度一樣，則完全隨機洗牌
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