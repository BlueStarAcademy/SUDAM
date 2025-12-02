import { TournamentState, PlayerForTournament, CoreStat, CommentaryLine, Match, User, Round, TournamentType, TournamentSimulationStatus } from '../types/index.js';
import { calculateTotalStats } from './statService.js';
import { randomUUID } from 'crypto';
import { TOURNAMENT_DEFINITIONS, NEIGHBORHOOD_MATCH_REWARDS, NATIONAL_MATCH_REWARDS, WORLD_MATCH_REWARDS, DUNGEON_STAGE_BOT_STATS, DUNGEON_TYPE_MULTIPLIER } from '../constants';

const EARLY_GAME_DURATION = 15;
const MID_GAME_DURATION = 20;
const END_GAME_DURATION = 15;
const TOTAL_GAME_DURATION = EARLY_GAME_DURATION + MID_GAME_DURATION + END_GAME_DURATION;

const STAT_WEIGHTS: Record<'early' | 'mid' | 'end', Partial<Record<CoreStat, number>>> = {
    early: {
        [CoreStat.CombatPower]: 0.4,
        [CoreStat.ThinkingSpeed]: 0.3,
        [CoreStat.Concentration]: 0.3,
    },
    mid: {
        [CoreStat.CombatPower]: 0.3,
        [CoreStat.Judgment]: 0.3,
        [CoreStat.Concentration]: 0.2,
        [CoreStat.Stability]: 0.2,
    },
    end: {
        [CoreStat.Calculation]: 0.5,
        [CoreStat.Stability]: 0.3,
        [CoreStat.Concentration]: 0.2,
    },
};

const COMMENTARY_POOLS = {
    start: "{p1}님과 {p2}님의 대국이 시작되었습니다.",
    early: [
        "양측 모두 신중하게 첫 수를 던지며 긴 대국의 막을 올립니다!",
        "기선 제압을 노리며 빠른 속도로 초반 포석이 전개되고 있습니다.",
        "서로의 의도를 파악하려는 탐색전이 이어지고 있습니다.",
        "중앙을 선점하며 주도권을 가져가려는 모습이 보입니다.",
        "조심스러운 수읽기로 서로의 진영을 가늠하고 있습니다."
    ],
    mid: [
        "격렬한 전투가 좌변에서 벌어지고 있습니다!",
        "돌들이 얽히며 복잡한 형세가 만들어지고 있습니다.",
        "상대의 허점을 노리며 강하게 파고듭니다.",
        "집중력이 흔들리면 단번에 무너질 수 있는 상황입니다.",
        "치열한 실랑이 끝에 국면의 균형이 살짝 기울고 있습니다.",
        "지금 이 수가 오늘 경기의 분수령이 될 수 있습니다!",
        "한 치의 수읽기 실수도 허용되지 않는 순간입니다.",
        "단 한 번의 판단이 승패를 좌우할 수 있는 형세입니다.",
        "집중력이 절정에 달하며 숨막히는 분위기가 이어집니다.",
        "방심은 금물! 작은 실수가 곧바로 대참사로 이어질 수 있습니다.",
        "조금씩 우세를 굳혀가며 안정적인 운영을 보여주고 있습니다.",
        "상대의 압박에 흔들리며 주도권을 잃어가고 있습니다.",
        "전투력에서 앞서는 듯하지만, 계산력에서 다소 뒤처지고 있습니다.",
        "양측의 형세가 팽팽하게 맞서며 누구도 쉽게 물러서지 않습니다.",
        "불리한 상황에서도 끝까지 흔들리지 않는 집중력이 돋보입니다."
    ],
    end: [
        "마지막 승부수를 던지며 역전을 노리고 있습니다!",
        "큰 집 계산에 들어가며 승패가 서서히 가려지고 있습니다.",
        "남은 수읽기에 모든 집중력을 쏟아붓고 있습니다.",
        "한 수 한 수가 경기 결과에 직결되는 종반입니다.",
        "치열한 승부 끝에 승자의 그림자가 드러나고 있습니다."
    ],
    win: [
        "마침내 승부가 갈렸습니다! {winner} 선수가 이번 라운드를 제압합니다!",
        "냉정한 판단으로 끝까지 우세를 유지하며 승리를 거머쥡니다.",
        "혼신의 집중력으로 극적인 역전을 만들어냅니다!",
        "안정적인 운영으로 상대를 압도하며 대국을 마무리합니다.",
        "치열한 접전 끝에 승자는 웃고, 패자는 아쉬움을 삼킵니다."
    ]
};


const getPhase = (time: number): 'early' | 'mid' | 'end' => {
    if (time <= EARLY_GAME_DURATION) return 'early';
    if (time <= EARLY_GAME_DURATION + MID_GAME_DURATION) return 'mid';
    return 'end';
};

const calculatePower = (player: PlayerForTournament, phase: 'early' | 'mid' | 'end') => {
    const weights = STAT_WEIGHTS[phase];
    let power = 0;
    for (const stat in weights) {
        const statKey = stat as CoreStat;
        const weight = weights[statKey]!;
        power += (player.stats[statKey] || 0) * weight;
    }
    return power;
};

const finishMatch = (
    match: Match,
    p1: PlayerForTournament,
    p2: PlayerForTournament,
    p1Cumulative: number,
    p2Cumulative: number
): { finalCommentary: CommentaryLine[]; winner: PlayerForTournament; } => {
    const totalCumulative = p1Cumulative + p2Cumulative;
    const p1Percent = totalCumulative > 0 ? (p1Cumulative / totalCumulative) * 100 : 50;

    let winner: PlayerForTournament;
    let commentaryText: string;

    const diffPercent = Math.abs(p1Percent - 50) * 2;
    const scoreDiff = (diffPercent / 2);
    const roundedDiff = Math.round(scoreDiff);
    const finalDiff = roundedDiff + 0.5;

    if (finalDiff < 0.5) { 
        winner = Math.random() < 0.5 ? p1 : p2;
        commentaryText = `[최종결과] ${winner.nickname}, 0.5집 승리!`;
    } else {
        winner = p1Percent > 50 ? p1 : p2;
        commentaryText = `[최종결과] ${winner.nickname}, ${finalDiff.toFixed(1)}집 승리!`;
    }
    
    const winComment = COMMENTARY_POOLS.win[Math.floor(Math.random() * COMMENTARY_POOLS.win.length)].replace('{winner}', winner.nickname);
    
    return {
        finalCommentary: [
            { text: commentaryText, phase: 'end', isRandomEvent: false },
            { text: winComment, phase: 'end', isRandomEvent: false }
        ],
        winner,
    };
};


const simulateAndFinishMatch = (match: Match, players: PlayerForTournament[], userId?: string) => {
    if (match.isFinished) return;
    if (!match.players[0] || !match.players[1]) {
        match.winner = match.players[0] || null;
        match.isFinished = true;
        return;
    }

    const p1 = players.find(p => p.id === match.players[0]!.id)!;
    const p2 = players.find(p => p.id === match.players[1]!.id)!;
    
    // 봇들 간 경기인 경우: 시뮬레이션 없이 랜덤으로 결과 결정
    if (!match.isUserMatch) {
        // 유저의 능력치를 originalStats로 복구 (봇 경기 중 유저 능력치 변경 방지)
        if (userId) {
            const userPlayer = players.find(p => p.id === userId);
            if (userPlayer && userPlayer.originalStats) {
                userPlayer.stats = JSON.parse(JSON.stringify(userPlayer.originalStats));
            }
        }
        
        // 랜덤으로 승자 결정 (50:50 확률)
        const winner = Math.random() < 0.5 ? p1 : p2;
        match.winner = winner;
        match.isFinished = true;
        
        // 랜덤 점수 생성 (45:55 ~ 55:45 범위)
        const scoreDiff = (Math.random() - 0.5) * 10; // -5 ~ +5
        const p1Percent = 50 + scoreDiff;
        const p2Percent = 100 - p1Percent;
        match.finalScore = { player1: p1Percent, player2: p2Percent };
        
        // 승자 업데이트
        if (winner.id === p1.id) {
            p1.wins++;
            p2.losses++;
        } else {
            p2.wins++;
            p1.losses++;
        }
        
        match.commentary = [{text: `${winner.nickname} 선수가 승리했습니다.`, phase: 'end', isRandomEvent: false}];
        return;
    }
    
    // 유저 경기인 경우: 기존 시뮬레이션 로직 실행
    // Reset stats to original values before starting the match simulation
    if (p1.originalStats) {
        p1.stats = JSON.parse(JSON.stringify(p1.originalStats));
    }
    if (p2.originalStats) {
        p2.stats = JSON.parse(JSON.stringify(p2.originalStats));
    }

    // 컨디션은 처음 세팅된 값을 유지 (변경하지 않음)
    // 유효하지 않은 컨디션(undefined, null, 1000, 또는 범위 밖)인 경우에만 경고만 출력
    if (p1.condition === undefined || p1.condition === null || p1.condition === 1000 || 
        p1.condition < 40 || p1.condition > 100) {
        console.warn(`[simulateAndFinishMatch] Invalid condition for p1 (${p1.id}): ${p1.condition}, keeping as is`);
    }
    if (p2.condition === undefined || p2.condition === null || p2.condition === 1000 || 
        p2.condition < 40 || p2.condition > 100) {
        console.warn(`[simulateAndFinishMatch] Invalid condition for p2 (${p2.id}): ${p2.condition}, keeping as is`);
    }

    let p1CumulativeScore = 0;
    let p2CumulativeScore = 0;

    for (let t = 1; t <= TOTAL_GAME_DURATION; t++) {
        const phase = getPhase(t);
        p1CumulativeScore += calculatePower(p1, phase);
        p2CumulativeScore += calculatePower(p2, phase);
    }
    
    const { winner } = finishMatch(match, p1, p2, p1CumulativeScore, p2CumulativeScore);
    
    match.winner = winner;
    match.isFinished = true;
    
    const totalScore = p1CumulativeScore + p2CumulativeScore;
    const p1Percent = totalScore > 0 ? (p1CumulativeScore / totalScore) * 100 : 50;
    match.finalScore = { player1: p1Percent, player2: 100 - p1Percent };

    // 승자 업데이트 (유저 경기)
    if (winner.id === p1.id) {
        p1.wins++;
        p2.losses++;
    } else {
        p2.wins++;
        p1.losses++;
    }

    match.commentary = [{text: "경기가 자동으로 진행되었습니다.", phase: 'end', isRandomEvent: false}];
};

export const prepareNextRound = (state: TournamentState, user: User) => {
    const lastRound = state.rounds[state.rounds.length - 1];
    if (lastRound.matches.every(m => m.isFinished)) {
        const winners = lastRound.matches.map(m => m.winner).filter(Boolean) as PlayerForTournament[];

        if (winners.length > 1) {
            // 3/4위전 생성: 4강이 끝났을 때 (전국바둑대회, 월드챔피언십 모두)
            // 3/4위전이 아직 생성되지 않았고, 4강이 끝났으면 생성
            if (state.type !== 'neighborhood' && lastRound.name === '4강' && winners.length === 2) {
                const hasThirdPlaceMatch = state.rounds.some(r => r.name === '3,4위전');
                if (!hasThirdPlaceMatch) {
                    const losers = lastRound.matches.map(m => m.players.find(p => p && p.id !== m.winner?.id)).filter(Boolean) as PlayerForTournament[];
                    if (losers.length === 2) {
                        const thirdPlaceMatch: Match = {
                            id: `m-${state.rounds.length + 1}-3rd`,
                            players: [losers[0], losers[1]],
                            winner: null, 
                            isFinished: false, 
                            commentary: [],
                            isUserMatch: (losers[0]?.id === user.id || losers[1]?.id === user.id),
                            finalScore: null,
                            sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                        };
                        state.rounds.push({ id: state.rounds.length + 1, name: "3,4위전", matches: [thirdPlaceMatch] });
                    }
                }
            }
            
            const nextRoundMatches: Match[] = [];
            for (let i = 0; i < winners.length; i += 2) {
                const p1 = winners[i];
                const p2 = winners[i + 1] || null;
                nextRoundMatches.push({
                    id: `m-${state.rounds.length + 1}-${i / 2}`,
                    players: [p1, p2],
                    winner: p2 === null ? p1 : null,
                    isFinished: !p2,
                    commentary: [],
                    isUserMatch: (p1?.id === user.id || p2?.id === user.id),
                    finalScore: null,
                    sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                });
            }
            const roundName = winners.length === 2 ? "결승" : `${winners.length}강`;
            state.rounds.push({ id: state.rounds.length + 1, name: roundName, matches: nextRoundMatches });
        }
    }
};

export const processMatchCompletion = (state: TournamentState, user: User, completedMatch: Match, roundIndex: number) => {
    state.currentSimulatingMatch = null;
    
    completedMatch.players.forEach(p => {
        if (p) {
            const playerInState = state.players.find(player => player.id === p.id);
            if (playerInState) {
                // 컨디션은 처음 조정한 값을 경기 끝까지 유지 (변경하지 않음)
                // 능력치는 originalStats로 복구
                if (playerInState.originalStats) {
                    playerInState.stats = JSON.parse(JSON.stringify(playerInState.originalStats));
                }
            }
        }
    });

    if (state.type === 'neighborhood') {
        // 동네바둑리그: 유저의 경기 완료 시 골드 누적
        if (completedMatch.isUserMatch && completedMatch.winner) {
            const isUserWinner = completedMatch.winner.id === user.id;
            const matchReward = NEIGHBORHOOD_MATCH_REWARDS[user.league];
            if (matchReward) {
                const goldEarned = isUserWinner ? matchReward.win : matchReward.loss;
                if (!state.accumulatedGold) {
                    state.accumulatedGold = 0;
                }
                state.accumulatedGold += goldEarned;
            }
        }
        
        const currentRound = state.currentRoundRobinRound || 1;
        // rounds 배열에서 name이 "1회차", "2회차" 등인 라운드 찾기
        const currentRoundObj = state.rounds.find(r => r.name === `${currentRound}회차`);
        
        if (!currentRoundObj) {
            state.status = 'complete';
            return;
        }
        
        const roundMatches = currentRoundObj.matches;

        // 유저가 아닌 매치들을 자동 처리
        roundMatches.forEach(m => {
            if (!m.isFinished && !m.isUserMatch) {
                simulateAndFinishMatch(m, state.players, user.id);
            }
        });
        
        const allRoundMatchesFinished = roundMatches.every(m => m.isFinished);

        if (allRoundMatchesFinished) {
            if (currentRound >= 5) {
                state.status = 'complete';
            } else {
                // 동네바둑리그: 다음 회차로 자동 진행
                state.currentRoundRobinRound = currentRound + 1;
                const nextRoundObj = state.rounds.find(r => r.name === `${currentRound + 1}회차`);
                if (nextRoundObj) {
                    const nextUserMatch = nextRoundObj.matches.find(m => m.isUserMatch && !m.isFinished);
                    if (nextUserMatch) {
                        // 2~5회차는 bracket_ready 상태로 설정 (클라이언트에서 카운트다운 처리)
                        state.status = 'bracket_ready';
                        // nextRoundStartTime은 클라이언트 카운트다운이 처리하므로 설정하지 않음
                        state.nextRoundStartTime = null;
                    } else {
                        state.status = 'complete';
                    }
                } else {
                    state.status = 'complete';
                }
            }
        }
        return;
    }
    
    const loser = completedMatch.players.find(p => p && p.id !== completedMatch.winner?.id) || null;

    // 전국바둑대회: 유저의 경기 완료 시 재료 누적
    if (state.type === 'national' && completedMatch.isUserMatch && completedMatch.winner) {
        const isUserWinner = completedMatch.winner.id === user.id;
        const matchReward = NATIONAL_MATCH_REWARDS[user.league];
        if (matchReward) {
            const materialReward = isUserWinner ? matchReward.win : matchReward.loss;
            if (!state.accumulatedMaterials) {
                state.accumulatedMaterials = {};
            }
            const currentQuantity = state.accumulatedMaterials[materialReward.materialName] || 0;
            state.accumulatedMaterials[materialReward.materialName] = currentQuantity + materialReward.quantity;
        }
    }

    // 월드챔피언십: 유저의 경기 완료 시 장비상자 누적
    if (state.type === 'world' && completedMatch.isUserMatch && completedMatch.winner) {
        const isUserWinner = completedMatch.winner.id === user.id;
        const matchReward = WORLD_MATCH_REWARDS[user.league];
        if (matchReward) {
            const boxReward = isUserWinner ? matchReward.win : matchReward.loss;
            if (!state.accumulatedEquipmentBoxes) {
                state.accumulatedEquipmentBoxes = {};
            }
            const currentQuantity = state.accumulatedEquipmentBoxes[boxReward.boxName] || 0;
            state.accumulatedEquipmentBoxes[boxReward.boxName] = currentQuantity + boxReward.quantity;
        }
    }

    // 전국바둑대회/월드챔피언십: 현재 라운드의 유저가 아닌 매치들을 자동 처리
    const currentRound = state.rounds[roundIndex];
    if (currentRound) {
        // 유저 경기가 끝나는 시점에 같은 라운드의 다른 경기들도 모두 자동 완료
        currentRound.matches.forEach(m => {
            if (!m.isFinished && !m.isUserMatch) {
                simulateAndFinishMatch(m, state.players, user.id);
            }
        });
        
        // 현재 라운드의 모든 경기가 완료되었는지 확인
        const currentRoundAllFinished = currentRound.matches.every(m => m.isFinished);
        
        if (currentRoundAllFinished) {
            // 다음 라운드 준비
            prepareNextRound(state, user);
            
            // 자동으로 다음 경기로 진행 (처음 컨디션 유지)
            const nextUserMatch = state.rounds
                .flatMap((round, rIdx) => round.matches.map((match, mIdx) => ({ match, roundIndex: rIdx, matchIndex: mIdx })))
                .find(({ match }) => !match.isFinished && match.isUserMatch);
            
            if (nextUserMatch) {
                // 다음 경기가 있으면 bracket_ready 상태로 설정 (클라이언트에서 카운트다운 처리)
                state.status = 'bracket_ready';
                // nextRoundStartTime은 클라이언트 카운트다운이 처리하므로 설정하지 않음
                state.nextRoundStartTime = null;
                // currentSimulatingMatch는 아직 설정하지 않음 (경기 시작 시 설정됨)
            } else {
                state.status = 'complete';
            }
        }
    }

    // 전국바둑대회/월드챔피언십: 유저 패배 시 자동 진행 종료
    if (loser?.id === user.id && (state.type === 'national' || state.type === 'world')) {
        // 유저가 패배했으므로 모든 경기를 자동으로 시뮬레이션하고 완료
        state.status = 'eliminated';
        
        // 현재 라운드의 모든 경기 완료
        const currentRound = state.rounds[roundIndex];
        if (currentRound) {
            currentRound.matches.forEach(match => {
                if (!match.isFinished) {
                    simulateAndFinishMatch(match, state.players, user.id);
                }
            });
        }
        
        // 모든 미완료 경기를 시뮬레이션하고 완료
        let safety = 0;
        while (safety < 50) {
            safety++;
            
            // 모든 미완료 경기 시뮬레이션
            let anyMatchSimulated = false;
            state.rounds.forEach(round => {
                round.matches.forEach(match => {
                    if (!match.isFinished) {
                        simulateAndFinishMatch(match, state.players, user.id);
                        anyMatchSimulated = true;
                    }
                });
            });
            
            // 완료된 라운드에서 다음 라운드 준비
            let nextRoundPrepared = false;
            for (let i = 0; i < state.rounds.length; i++) {
                const round = state.rounds[i];
                const roundAllFinished = round.matches.every(m => m.isFinished);
                
                if (roundAllFinished) {
                    const nextRoundExists = i + 1 < state.rounds.length;
                    
                    if (!nextRoundExists) {
                        const winners = round.matches.map(m => m.winner).filter(Boolean) as PlayerForTournament[];
                        
                        if (winners.length > 1 && round.name !== '결승' && round.name !== '3,4위전') {
                            const nextRoundMatches: Match[] = [];
                            for (let j = 0; j < winners.length; j += 2) {
                                const p1 = winners[j];
                                const p2 = winners[j + 1] || null;
                                nextRoundMatches.push({
                                    id: `m-${state.rounds.length + 1}-${j / 2}`,
                                    players: [p1, p2],
                                    winner: p2 === null ? p1 : null,
                                    isFinished: !p2,
                                    commentary: [],
                                    isUserMatch: false,
                                    finalScore: null,
                                    sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                                });
                            }
                            const roundName = winners.length === 2 ? "결승" : `${winners.length}강`;
                            state.rounds.push({ id: state.rounds.length + 1, name: roundName, matches: nextRoundMatches });
                            nextRoundPrepared = true;
                            break;
                        } else if (round.name === '4강' && (state.type === 'national' || state.type === 'world')) {
                            // 4강 완료 시 3/4위전과 결승전 준비
                            const hasThirdPlaceMatch = state.rounds.some(r => r.name === '3,4위전');
                            if (!hasThirdPlaceMatch) {
                                const losers = round.matches.map(m => m.players.find(p => p && p.id !== m.winner?.id)).filter(Boolean) as PlayerForTournament[];
                                if (losers.length === 2) {
                                    const thirdPlaceMatch: Match = {
                                        id: `m-${state.rounds.length + 1}-3rd`,
                                        players: [losers[0], losers[1]],
                                        winner: null,
                                        isFinished: false,
                                        commentary: [],
                                        isUserMatch: false,
                                        finalScore: null,
                                        sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                                    };
                                    state.rounds.push({ id: state.rounds.length + 1, name: "3,4위전", matches: [thirdPlaceMatch] });
                                }
                            }
                            const winners = round.matches.map(m => m.winner).filter(Boolean) as PlayerForTournament[];
                            if (winners.length === 2) {
                                const finalMatch: Match = {
                                    id: `m-${state.rounds.length + 1}-final`,
                                    players: [winners[0], winners[1]],
                                    winner: null,
                                    isFinished: false,
                                    commentary: [],
                                    isUserMatch: false,
                                    finalScore: null,
                                    sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                                };
                                state.rounds.push({ id: state.rounds.length + 1, name: "결승", matches: [finalMatch] });
                                nextRoundPrepared = true;
                                break;
                            }
                        }
                    }
                }
            }
            
            if (nextRoundPrepared) {
                const lastRound = state.rounds[state.rounds.length - 1];
                lastRound.matches.forEach(match => {
                    if (!match.isFinished) {
                        simulateAndFinishMatch(match, state.players, user.id);
                    }
                });
            } else if (!anyMatchSimulated) {
                break;
            }
            
            const allMatchesFinished = state.rounds.every(r => r.matches.every(m => m.isFinished));
            if (allMatchesFinished) {
                break;
            }
        }
        
        state.status = 'complete';
        return;
    }
    
    // 이전 로직 (유저가 패배했지만 3/4위전 등이 남은 경우) - 이제는 사용하지 않음
    if (loser?.id === user.id) {
        // 유저가 패배한 경우: 유저가 참가하는 경기(예: 3/4위전)가 남아있는지 확인
        const hasUnfinishedUserMatch = state.rounds.some(r => 
            r.matches.some(m => !m.isFinished && m.isUserMatch)
        );
        
        if (hasUnfinishedUserMatch) {
            // 유저가 참가하는 경기가 남아있으면 유저가 참가하지 않는 경기만 자동 완료
            state.rounds.forEach(round => {
                round.matches.forEach(match => {
                    if (!match.isFinished && !match.isUserMatch) {
                        simulateAndFinishMatch(match, state.players, user.id);
                    }
                });
            });
            
            // 현재 라운드의 모든 경기가 완료되었는지 확인하고 다음 라운드 준비
            const currentRound = state.rounds[roundIndex];
            if (currentRound) {
                const currentRoundAllFinished = currentRound.matches.every(m => m.isFinished);
                if (currentRoundAllFinished) {
                    prepareNextRound(state, user);
                    
                    // 자동으로 다음 경기로 진행 (처음 컨디션 유지)
                    const nextUserMatch = state.rounds
                        .flatMap((round, rIdx) => round.matches.map((match, mIdx) => ({ match, roundIndex: rIdx, matchIndex: mIdx })))
                        .find(({ match }) => !match.isFinished && match.isUserMatch);
                    
                    if (nextUserMatch) {
                        // 유저의 다음 경기가 있으면 자동으로 시작
                        state.status = 'bracket_ready';
                        // 자동으로 경기 시작 (컨디션 유지)
                        state.currentSimulatingMatch = { roundIndex: nextUserMatch.roundIndex, matchIndex: nextUserMatch.matchIndex };
                        state.currentMatchCommentary = [];
                        state.timeElapsed = 0;
                        state.currentMatchScores = { player1: 0, player2: 0 };
                        state.lastScoreIncrement = null;
                        state.simulationSeed = undefined;
                    } else {
                        // 유저의 다음 경기가 없으면 완료
                        state.status = 'complete';
                    }
                    if (state.status === 'bracket_ready') {
                        state.nextRoundStartTime = Date.now() + 5000;
                    }
                }
            }
            
            // 유저가 참가하는 경기가 남아있으므로 round_complete 상태로 설정 (다음경기 버튼 표시)
            // 단, startNextRound에서 bracket_ready로 설정되었을 수 있으므로 확인
            if (state.status !== 'bracket_ready') {
                state.status = 'round_complete';
            }
        } else {
            // 유저가 참가하는 경기가 없으면 모든 경기를 자동으로 시뮬레이션하고 완료
            state.status = 'eliminated';
            
            // 먼저 현재 라운드의 모든 경기를 완료시킴
            const currentRound = state.rounds[roundIndex];
            if (currentRound) {
                currentRound.matches.forEach(match => {
                    if (!match.isFinished) {
                        simulateAndFinishMatch(match, state.players, user.id);
                    }
                });
            }
            
            // 모든 미완료 경기를 시뮬레이션하고 완료 (결승전까지 포함)
            // 탈락 시 모든 라운드를 순차적으로 생성하고 시뮬레이션
            let safety = 0;
            while (safety < 50) { // safety limit 증가 (16강 -> 8강 -> 4강 -> 결승 -> 3/4위전)
                safety++;
                
                // 먼저 모든 미완료 경기를 시뮬레이션하여 현재 라운드를 완료시킴
                let anyMatchSimulated = false;
                state.rounds.forEach(round => {
                    round.matches.forEach(match => {
                        if (!match.isFinished) {
                            simulateAndFinishMatch(match, state.players, user.id);
                            anyMatchSimulated = true;
                        }
                    });
                });
                
                // 모든 라운드를 확인하여 완료된 라운드에서 다음 라운드 준비
                let nextRoundPrepared = false;
                for (let i = 0; i < state.rounds.length; i++) {
                    const round = state.rounds[i];
                    // 현재 라운드의 모든 경기가 완료되었는지 확인
                    const roundAllFinished = round.matches.every(m => m.isFinished);
                    
                    if (roundAllFinished) {
                        // 다음 라운드가 이미 존재하는지 확인
                        const nextRoundExists = i + 1 < state.rounds.length;
                        
                        if (!nextRoundExists) {
                            // 다음 라운드가 없으면 준비
                            const winners = round.matches.map(m => m.winner).filter(Boolean) as PlayerForTournament[];
                            
                            // 결승전이 아니고 우승자가 2명 이상이면 다음 라운드 준비
                            if (winners.length > 1 && round.name !== '결승' && round.name !== '3,4위전') {
                                // prepareNextRound를 호출하기 전에 해당 라운드가 완료되었는지 확인
                                // prepareNextRound는 lastRound가 완료되어야 작동하므로, 여기서는 직접 다음 라운드를 생성
                                const nextRoundMatches: Match[] = [];
                                for (let j = 0; j < winners.length; j += 2) {
                                    const p1 = winners[j];
                                    const p2 = winners[j + 1] || null;
                                    nextRoundMatches.push({
                                        id: `m-${state.rounds.length + 1}-${j / 2}`,
                                        players: [p1, p2],
                                        winner: p2 === null ? p1 : null,
                                        isFinished: !p2,
                                        commentary: [],
                                        isUserMatch: false, // 유저는 이미 탈락했으므로 false
                                        finalScore: null,
                                        sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                                    });
                                }
                                const roundName = winners.length === 2 ? "결승" : `${winners.length}강`;
                                state.rounds.push({ id: state.rounds.length + 1, name: roundName, matches: nextRoundMatches });
                                nextRoundPrepared = true;
                                break;
                            } else if (round.name === '4강' && (state.type === 'national' || state.type === 'world')) {
                                // 4강이 완료되었으면 3/4위전과 결승전 준비
                                // 먼저 3/4위전이 있는지 확인
                                const hasThirdPlaceMatch = state.rounds.some(r => r.name === '3,4위전');
                                if (!hasThirdPlaceMatch) {
                                    // 3/4위전 생성
                                    const losers = round.matches.map(m => m.players.find(p => p && p.id !== m.winner?.id)).filter(Boolean) as PlayerForTournament[];
                                    if (losers.length === 2) {
                                        const thirdPlaceMatch: Match = {
                                            id: `m-${state.rounds.length + 1}-3rd`,
                                            players: [losers[0], losers[1]],
                                            winner: null, 
                                            isFinished: false, 
                                            commentary: [],
                                            isUserMatch: false, // 유저는 이미 탈락했으므로 false
                                            finalScore: null,
                                            sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                                        };
                                        state.rounds.push({ id: state.rounds.length + 1, name: "3,4위전", matches: [thirdPlaceMatch] });
                                    }
                                }
                                // 결승전 준비
                                const winners = round.matches.map(m => m.winner).filter(Boolean) as PlayerForTournament[];
                                if (winners.length === 2) {
                                    const finalMatch: Match = {
                                        id: `m-${state.rounds.length + 1}-final`,
                                        players: [winners[0], winners[1]],
                                        winner: null,
                                        isFinished: false,
                                        commentary: [],
                                        isUserMatch: false,
                                        finalScore: null,
                                        sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                                    };
                                    state.rounds.push({ id: state.rounds.length + 1, name: "결승", matches: [finalMatch] });
                                    nextRoundPrepared = true;
                                    break;
                                }
                            }
                        }
                    }
                }
                
                // 다음 라운드를 준비했으면 새로 준비된 라운드의 경기들을 시뮬레이션
                if (nextRoundPrepared) {
                    // 새로 준비된 라운드의 모든 경기를 시뮬레이션
                    const lastRound = state.rounds[state.rounds.length - 1];
                    lastRound.matches.forEach(match => {
                        if (!match.isFinished) {
                            simulateAndFinishMatch(match, state.players, user.id);
                        }
                    });
                } else if (!anyMatchSimulated) {
                    // 경기를 시뮬레이션할 수 없고 다음 라운드도 준비할 수 없으면 종료
                    break;
                }

                // 모든 매치가 완료되었는지 확인
                const allMatchesFinished = state.rounds.every(r => r.matches.every(m => m.isFinished));
                
                if (allMatchesFinished) {
                    // 모든 경기가 완료되었으면 종료
                    break;
                }
            }
            
            // 모든 경기가 완료되었는지 최종 확인
            const finalAllMatchesFinished = state.rounds.every(r => r.matches.every(m => m.isFinished));
            if (finalAllMatchesFinished) {
                // 모든 경기가 완료되었으므로 eliminated 상태 유지 (보상 수령 가능)
                        // 컨디션은 처음 설정된 값을 유지 (변경하지 않음)
            } else {
                // 아직 완료되지 않은 경기가 있으면 강제로 완료
                state.rounds.forEach(round => {
                    round.matches.forEach(match => {
                        if (!match.isFinished) {
                            simulateAndFinishMatch(match, state.players, user.id);
                        }
                    });
                });
                // 모든 경기 완료 후 유저의 컨디션은 유지, 상대방만 초기화
                state.players.forEach(p => {
                    if (p.id !== user.id) {
                        p.condition = 1000;
                    }
                });
            }
        }
    } else {
        // 유저가 승리한 경우
        const allTournamentMatchesFinished = state.rounds.every(r => r.matches.every(m => m.isFinished));
        if (allTournamentMatchesFinished) {
             state.status = 'complete';
                        // 컨디션은 처음 설정된 값을 유지 (변경하지 않음)
        } else {
             // 현재 라운드가 완료되었으면 round_complete 상태로 설정
             const currentRoundAllFinished = currentRound?.matches.every(m => m.isFinished) || false;
             if (currentRoundAllFinished) {
                 // prepareNextRound가 호출되었으므로 다음 라운드가 준비되었는지 확인
                 // 마지막 라운드의 모든 경기가 완료되었는지 확인
                 const lastRound = state.rounds[state.rounds.length - 1];
                 
                 // 결승전이 완료되었으면 바로 완료 상태로 설정
                 if (currentRound.name === '결승' || currentRound.name === '3,4위전') {
                     // 결승전 또는 3/4위전이 완료되었으면 모든 경기가 완료된 것
                     // 남은 경기가 있는지 확인
                     const remainingMatches = state.rounds.some(r => 
                         r.matches.some(m => !m.isFinished)
                     );
                     if (!remainingMatches) {
                         state.status = 'complete';
                     } else {
                         // 남은 경기가 있으면 자동 완료
                         state.rounds.forEach(round => {
                             round.matches.forEach(match => {
                                 if (!match.isFinished) {
                                     simulateAndFinishMatch(match, state.players, user.id);
                                 }
                             });
                         });
                         state.status = 'complete';
                        // 컨디션은 처음 설정된 값을 유지 (변경하지 않음)
                     }
                 } else {
                     // 다음 라운드가 준비되었는지 확인하고 startNextRound 호출
                     const lastRound = state.rounds[state.rounds.length - 1];
                     const hasNextRound = lastRound && lastRound.matches.some(m => !m.isFinished);
                     
                     // 또는 유저의 다음 경기가 있는지 확인
                     const hasNextUserMatch = state.rounds.some(r => 
                         r.matches.some(m => !m.isFinished && m.isUserMatch)
                     );
                     
                    if (hasNextRound || hasNextUserMatch) {
                        // prepareNextRound가 아직 호출되지 않았을 수 있으므로 호출
                        prepareNextRound(state, user);
                        
                        // 자동으로 다음 경기로 진행 (처음 컨디션 유지)
                        const nextUserMatch = state.rounds
                            .flatMap((round, rIdx) => round.matches.map((match, mIdx) => ({ match, roundIndex: rIdx, matchIndex: mIdx })))
                            .find(({ match }) => !match.isFinished && match.isUserMatch);
                        
                        if (nextUserMatch) {
                            // 유저의 다음 경기가 있으면 자동으로 시작
                            state.status = 'bracket_ready';
                            // 자동으로 경기 시작 (컨디션 유지)
                            state.currentSimulatingMatch = { roundIndex: nextUserMatch.roundIndex, matchIndex: nextUserMatch.matchIndex };
                            state.currentMatchCommentary = [];
                            state.timeElapsed = 0;
                            state.currentMatchScores = { player1: 0, player2: 0 };
                            state.lastScoreIncrement = null;
                            state.simulationSeed = undefined;
                        } else {
                            // 유저의 다음 경기가 없으면 완료
                            state.status = 'complete';
                        }
                    } else {
                        // 다음 라운드가 없으면 완료
                        state.status = 'complete';
                        // 컨디션은 처음 설정된 값을 유지 (변경하지 않음)
                    }
                 }
             } else {
                 // 아직 현재 라운드에 미완료 경기가 있으면 대기 (이론적으로는 발생하지 않아야 함)
                 state.status = 'round_complete';
             }
        }
    }
};

export const createTournament = (type: TournamentType, user: User, players: PlayerForTournament[]): TournamentState => {
    const definition = TOURNAMENT_DEFINITIONS[type];
    const rounds: Round[] = [];
    
    // 경기 시작 전에 컨디션을 40~100 사이로 랜덤 부여
    players.forEach(p => p.condition = Math.floor(Math.random() * 61) + 40);

    if (definition.format === 'tournament') {
        const matches: Match[] = [];
        for (let i = 0; i < players.length; i += 2) {
            const p1 = players[i];
            const p2 = players[i + 1] || null;
            matches.push({
                id: `m-1-${i / 2}`,
                players: [p1, p2],
                winner: p2 === null ? p1 : null,
                isFinished: !p2,
                commentary: [],
                isUserMatch: (p1?.id === user.id || p2?.id === user.id),
                finalScore: null,
                sgfFileIndex: Math.floor(Math.random() * 18) + 1,
            });
        }
        rounds.push({ id: 1, name: `${players.length}강`, matches });
    } else { // round-robin for 'neighborhood'
        // 6인 풀리그: 5회차로 나누어 진행
        // 각 회차마다 3경기씩 진행 (총 15경기 = 6C2)
        const schedule = [
            [[0, 5], [1, 4], [2, 3]],  // 1회차
            [[0, 4], [5, 3], [1, 2]],  // 2회차
            [[0, 3], [4, 2], [5, 1]],  // 3회차
            [[0, 2], [3, 1], [4, 5]],  // 4회차
            [[0, 1], [2, 5], [3, 4]],  // 5회차
        ];

        // 5개의 라운드(1~5회차) 생성
        for (let roundNum = 1; roundNum <= 5; roundNum++) {
            const roundPairings = schedule[roundNum - 1];
            const roundMatches: Match[] = [];
            
            roundPairings.forEach((pair, index) => {
                const p1 = players[pair[0]];
                const p2 = players[pair[1]];
                roundMatches.push({
                    id: `m-${roundNum}-${index}`,
                    players: [p1, p2],
                    winner: null,
                    isFinished: false,
                    commentary: [],
                    isUserMatch: (p1.id === user.id || p2.id === user.id),
                    finalScore: null,
                    sgfFileIndex: Math.floor(Math.random() * 18) + 1,
                });
            });
            
            rounds.push({ id: roundNum, name: `${roundNum}회차`, matches: roundMatches });
        }
    }

    return {
        type,
        status: 'bracket_ready',
        title: definition.name,
        players,
        rounds,
        currentSimulatingMatch: null,
        currentMatchCommentary: [],
        lastPlayedDate: Date.now(),
        nextRoundStartTime: null, // 첫 경기는 수동 시작 (유저가 경기 시작 버튼을 눌러야 함)
        timeElapsed: 0,
        accumulatedGold: type === 'neighborhood' ? 0 : undefined, // 동네바둑리그만 골드 누적
        accumulatedMaterials: type === 'national' ? {} : undefined, // 전국바둑대회만 재료 누적
        accumulatedEquipmentBoxes: type === 'world' ? {} : undefined, // 월드챔피언십만 장비상자 누적
    };
};

export const startNextRound = (state: TournamentState, user: User) => {
    if (state.status === 'round_in_progress') return;
    
    // 경기가 완료된 상태에서는 컨디션을 변경하지 않음
    if (state.status === 'complete' || state.status === 'eliminated') {
        return;
    }
    
    if (state.type === 'neighborhood') {
        // round_complete 상태에서 startNextRound가 호출되면 컨디션을 부여하고 bracket_ready로 변경
        // bracket_ready 상태에서 다시 호출되면 컨디션이 이미 부여된 상태이므로 early return
        const isComingFromRoundComplete = state.status === 'round_complete';
        const isAlreadyBracketReady = state.status === 'bracket_ready';
        
            if (isAlreadyBracketReady) {
            // bracket_ready 상태에서는 이미 컨디션이 부여된 상태이므로 startNextRound를 호출하지 않아야 함
            // (뒤로가기 후 다시 들어온 경우 상태 유지)
            // 컨디션은 처음 설정된 값을 유지 (변경하지 않음)
            return;
        }
        
        if (isComingFromRoundComplete) {
            // round_complete 상태에서 다음 회차로 넘어가기
            state.currentRoundRobinRound = (state.currentRoundRobinRound || 0) + 1;
        }

        const currentRound = state.currentRoundRobinRound || 1;
        if (currentRound > 5) {
            state.status = 'complete';
            return;
        }

        // 현재 회차의 라운드 찾기 (name이 "1회차", "2회차" 등인 라운드)
        const currentRoundObj = state.rounds.find(r => r.name === `${currentRound}회차`);
        if (!currentRoundObj) {
            state.status = 'complete';
            return;
        }
        
        // 다음 회차로 넘어갈 때 컨디션을 새롭게 부여 (40~100 사이 랜덤)
        // 능력치는 START_TOURNAMENT_ROUND 액션에서 이미 최신 능력치로 업데이트되었으므로
        // 여기서는 originalStats를 사용하여 stats를 복구 (최신 장비와 보너스 포인트 반영)
        const userPlayer = state.players.find(p => p.id === user.id);
        if (userPlayer && userPlayer.originalStats) {
            // originalStats로 능력치 복구 (START_TOURNAMENT_ROUND에서 최신 능력치로 업데이트됨)
            userPlayer.stats = JSON.parse(JSON.stringify(userPlayer.originalStats));
        }
        
        // 컨디션은 처음 세팅된 값을 유지 (변경하지 않음)
        // 능력치는 originalStats로 리셋
        state.players.forEach(p => {
            if (p.originalStats) {
                p.stats = JSON.parse(JSON.stringify(p.originalStats));
            }
            // 컨디션은 변경하지 않음 (처음 설정된 값 유지)
        });
        
        // 다음 회차로 넘어갈 때 중계 내용 초기화
        state.currentMatchCommentary = [];
        state.currentSimulatingMatch = null;
        state.timeElapsed = 0;
        state.currentMatchScores = { player1: 0, player2: 0 };
        state.lastScoreIncrement = null;
        
        const roundMatches = currentRoundObj.matches;
    
        // 유저의 매치 찾기
        const userMatchInRound = roundMatches.find(m => m.isUserMatch && !m.isFinished);
    
        if (userMatchInRound) {
            // 유저의 매치가 있으면 대기 상태로 두고, 유저가 경기 시작 버튼을 눌러야 시작됨
            // 경기 시작은 START_TOURNAMENT_MATCH 액션으로 처리됨
            state.status = 'bracket_ready';
            // currentRoundRobinRound가 아직 설정되지 않았으면 설정
            if (!state.currentRoundRobinRound) {
                state.currentRoundRobinRound = currentRound;
            }
        } else {
            // 유저의 매치가 없으면 모든 매치를 자동 처리
            roundMatches.forEach(m => {
                if (!m.isFinished) {
                    simulateAndFinishMatch(m, state.players, user.id);
                }
            });
            state.status = 'round_complete';
        }
        return;
    }
    
    // 전국바둑대회와 월드챔피언십도 동네바둑리그처럼 자동으로 경기를 시작하지 않음
    // 유저가 직접 경기 시작 버튼을 눌러야 함 (START_TOURNAMENT_ROUND 액션으로 처리)
    
    // 능력치는 START_TOURNAMENT_ROUND 액션에서 이미 최신 능력치로 업데이트되었으므로
    // 여기서는 originalStats를 사용하여 stats를 복구 (최신 장비와 보너스 포인트 반영)
    const userPlayer = state.players.find(p => p.id === user.id);
    if (userPlayer && userPlayer.originalStats) {
        // originalStats로 능력치 복구 (START_TOURNAMENT_ROUND에서 최신 능력치로 업데이트됨)
        userPlayer.stats = JSON.parse(JSON.stringify(userPlayer.originalStats));
    }
    
    // 컨디션은 처음 세팅된 값을 유지 (변경하지 않음)
    // 모든 플레이어의 컨디션을 처음 설정된 값으로 유지
    // 능력치는 originalStats로 리셋
    state.players.forEach(p => {
        if (p.originalStats) {
            p.stats = JSON.parse(JSON.stringify(p.originalStats));
        }
        // 컨디션은 변경하지 않음 (처음 설정된 값 유지)
    });
    
    // 다음 회차로 넘어갈 때 중계 내용 초기화
    state.currentMatchCommentary = [];
    state.currentSimulatingMatch = null;
    state.timeElapsed = 0;
    state.currentMatchScores = { player1: 0, player2: 0 };
    state.lastScoreIncrement = null;
    // 시뮬레이션 시드 초기화 (START_TOURNAMENT_MATCH에서 새로 생성됨)
    state.simulationSeed = undefined;
    
    const nextMatchToSimulate = state.rounds
        .flatMap((round, roundIndex) => round.matches.map((match, matchIndex) => ({ match, roundIndex, matchIndex })))
        .find(({ match }) => !match.isFinished && match.isUserMatch);

    if (nextMatchToSimulate) {
        // 유저의 매치가 있으면 대기 상태로 두고, 유저가 경기 시작 버튼을 눌러야 시작됨
        // 경기 시작은 START_TOURNAMENT_ROUND 액션으로 처리됨
        state.status = 'bracket_ready';
        
        // 완료된 유저 경기 수 확인 (첫 경기인지 판단)
        const finishedUserMatches = state.rounds.reduce((count, r) => {
            return count + r.matches.filter(m => m.isUserMatch && m.isFinished).length;
        }, 0);
        
        // 클라이언트에서 카운트다운이 처리하므로 nextRoundStartTime 설정하지 않음
        state.nextRoundStartTime = null;
        
        // 컨디션은 처음 세팅된 값을 유지 (변경하지 않음)
        // 능력치는 originalStats로 리셋
        state.players.forEach(p => {
            if (p.originalStats) {
                p.stats = JSON.parse(JSON.stringify(p.originalStats));
            }
            // 컨디션은 변경하지 않음 (처음 설정된 값 유지)
        });
    } else {
        // 유저의 매치가 없으면 모든 매치를 자동 처리
        state.rounds.forEach(round => {
            round.matches.forEach(match => {
                if (!match.isFinished && !match.isUserMatch) {
                    simulateAndFinishMatch(match, state.players, user.id);
                }
            });
        });
        state.status = 'round_complete';
    }
};

export const skipToResults = (state: TournamentState, userId: string) => {
    if (state.status === 'complete') return;

    // eliminated 상태도 처리 (유저가 패배해도 나머지 경기는 진행)
    if (state.status === 'eliminated') {
        state.status = 'round_complete';
    }

    const user = { id: userId } as User;
    let safety = 0; // prevent infinite loops
    while (safety < 20) {
        if ((state.status as any) === 'complete') {
            break;
        }
        safety++;

        // 현재 라운드의 모든 미완료 매치를 시뮬레이션하고 완료
        let hasUnfinishedMatches = false;
        state.rounds.forEach(round => {
            round.matches.forEach(match => {
                if (!match.isFinished) {
                    hasUnfinishedMatches = true;
                    simulateAndFinishMatch(match, state.players, userId);
                }
            });
        });

        // 모든 매치가 완료되었는지 확인
        const allMatchesFinished = state.rounds.every(r => r.matches.every(m => m.isFinished));
        
        if (allMatchesFinished) {
            // 다음 라운드가 필요한지 확인하고 준비
            const lastRound = state.rounds[state.rounds.length - 1];
            const winners = lastRound.matches.map(m => m.winner).filter(Boolean) as PlayerForTournament[];
            
            // 결승전이 아니고 우승자가 2명 이상이면 다음 라운드 준비
            if (winners.length > 1 && lastRound.name !== '결승') {
                prepareNextRound(state, user);
                // 다음 라운드의 매치들을 즉시 시뮬레이션 (계속 진행)
                continue;
            } else {
                // 모든 경기가 끝났거나 결승전이 끝났으면 완료
                state.status = 'complete';
                break;
            }
        } else if (hasUnfinishedMatches) {
            // 매치가 있었는데 아직 완료되지 않았으면 계속 진행
            continue;
        } else {
            // 모든 매치가 완료되었고 다음 라운드가 필요 없으면 완료
            state.status = 'complete';
            break;
        }
    }
    
    // Finalize state
    state.currentSimulatingMatch = null;
    state.timeElapsed = TOTAL_GAME_DURATION;
    
    // 안전장치: 여전히 완료되지 않았으면 강제로 완료
    if (state.status !== 'complete') {
        state.status = 'complete';
    }
};

export const forfeitTournament = (state: TournamentState, userId: string) => {
    if (state.status === 'complete' || state.status === 'eliminated') return;

    state.rounds.forEach(round => {
        round.matches.forEach(match => {
            if (!match.isFinished && match.players.some(p => p?.id === userId)) {
                match.isFinished = true;
                match.winner = match.players.find(p => p && p.id !== userId) || null;
            }
        });
    });

    state.status = 'eliminated';
};

export const forfeitCurrentMatch = (state: TournamentState, user: User) => {
    if (state.status !== 'round_in_progress' || !state.currentSimulatingMatch) return;

    const { roundIndex, matchIndex } = state.currentSimulatingMatch;
    
    if (roundIndex >= state.rounds.length || matchIndex >= state.rounds[roundIndex].matches.length) {
        return;
    }

    const match = state.rounds[roundIndex].matches[matchIndex];
    
    if (!match.isFinished && match.players.some(p => p?.id === user.id)) {
        match.isFinished = true;
        match.winner = match.players.find(p => p && p.id !== user.id) || null;
        
        // 현재 매치를 완료 처리하고 다음 단계로 진행
        processMatchCompletion(state, user, match, roundIndex);
    }
};

export const advanceSimulation = (state: TournamentState, user: User): boolean => {
    if (state.status !== 'round_in_progress' || !state.currentSimulatingMatch) return false;

    const { roundIndex, matchIndex } = state.currentSimulatingMatch;
    
    // Validate round and match indices
    if (!state.rounds || roundIndex >= state.rounds.length || !state.rounds[roundIndex]) {
        console.error(`[advanceSimulation] Invalid roundIndex: ${roundIndex}, total rounds: ${state.rounds?.length || 0}`);
        return false;
    }
    
    const round = state.rounds[roundIndex];
    if (!round.matches || matchIndex >= round.matches.length || !round.matches[matchIndex]) {
        console.error(`[advanceSimulation] Invalid matchIndex: ${matchIndex}, total matches: ${round.matches?.length || 0}`);
        return false;
    }
    
    const match = round.matches[matchIndex];

    if (!match.players[0] || !match.players[1]) {
        match.winner = match.players[0] || null;
        match.isFinished = true;
        processMatchCompletion(state, user, match, roundIndex);
        return true;
    }

    // 클라이언트에서 전달된 타임스탬프 사용 (클라이언트에서 실행하므로)
    // 클라이언트 타임스탬프는 ADVANCE_TOURNAMENT_SIMULATION 액션에서 전달됨
    // 하지만 이 함수는 서버에서도 호출될 수 있으므로, 전달된 타임스탬프가 없으면 서버 시간 사용
    const clientTimestamp = (state as any).__clientTimestamp as number | undefined;
    const now = clientTimestamp !== undefined ? clientTimestamp : Date.now();
    
    if (state.lastSimulationTime === undefined) {
        // 첫 실행 시 초기화
        state.lastSimulationTime = now;
        if (state.timeElapsed === 0) {
            state.currentMatchScores = { player1: 0, player2: 0 };
            state.lastScoreIncrement = null;
        }
        state.timeElapsed = 1;
    } else {
        // 클라이언트에서 정확히 1초마다 호출되므로, 항상 1초씩만 진행
        if (state.timeElapsed === 0) {
            state.timeElapsed = 1;
            state.currentMatchScores = { player1: 0, player2: 0 };
            state.lastScoreIncrement = null;
        } else {
            state.timeElapsed++;
        }
        state.lastSimulationTime = state.lastSimulationTime + 1000; // 정확히 1초 증가
    }
    
    // 클라이언트 타임스탬프 제거 (다음 호출을 위해)
    delete (state as any).__clientTimestamp;
    
    const p1 = state.players.find(p => p.id === match.players[0]!.id);
    const p2 = state.players.find(p => p.id === match.players[1]!.id);
    
    if (!p1 || !p2) {
        console.error(`[advanceSimulation] Player not found: p1=${!!p1}, p2=${!!p2}, match.players[0]=${match.players[0]?.id}, match.players[1]=${match.players[1]?.id}`);
        return false;
    }

    if (state.timeElapsed === 1) {
        // 유저 플레이어의 경우 originalStats로 리셋하지 않음 (경기 시작 시 이미 최신 능력치로 업데이트됨)
        // 상대방(봇 또는 다른 유저)만 originalStats로 리셋
        if (p1.originalStats && p1.id !== user.id) {
            p1.stats = JSON.parse(JSON.stringify(p1.originalStats));
        }
        if (p2.originalStats && p2.id !== user.id) {
            p2.stats = JSON.parse(JSON.stringify(p2.originalStats));
        }

        // 경기 시작 시 컨디션은 절대 변경하지 않음 (이미 부여된 컨디션이나 회복제로 변경된 컨디션 유지)
        // 단, 컨디션이 1000(초기값)이거나 undefined/null이거나 유효 범위(40-100)를 벗어난 경우에만 랜덤 부여 (하위 호환성)
        // 유효한 컨디션(40-100 사이)이 이미 부여되어 있으면 절대 변경하지 않음
        if (state.status === 'round_in_progress') {
            // p1 컨디션 확인 및 부여 (유효한 컨디션이 없을 때만)
            // 유저의 경우 컨디션을 절대 변경하지 않음 (회복제로 변경된 컨디션 유지)
            if (p1.id === user.id) {
                // 유저의 컨디션은 절대 변경하지 않음
                if (p1.condition === undefined || p1.condition === null || p1.condition === 1000 || 
                    p1.condition < 40 || p1.condition > 100) {
                    // 유저의 컨디션이 유효하지 않은 경우에만 부여 (하위 호환성)
                    p1.condition = Math.floor(Math.random() * 61) + 40; // 40-100
                }
            } else {
                // 상대방의 경우에만 컨디션 확인 및 부여 (유효한 컨디션이 없을 때만)
                if (p1.condition === undefined || p1.condition === null || p1.condition === 1000 || 
                    p1.condition < 40 || p1.condition > 100) {
                    p1.condition = Math.floor(Math.random() * 61) + 40; // 40-100
                }
            }
            // p2 컨디션 확인 및 부여 (유효한 컨디션이 없을 때만)
            // 유저의 경우 컨디션을 절대 변경하지 않음 (회복제로 변경된 컨디션 유지)
            if (p2.id === user.id) {
                // 유저의 컨디션은 절대 변경하지 않음
                if (p2.condition === undefined || p2.condition === null || p2.condition === 1000 || 
                    p2.condition < 40 || p2.condition > 100) {
                    // 유저의 컨디션이 유효하지 않은 경우에만 부여 (하위 호환성)
                    p2.condition = Math.floor(Math.random() * 61) + 40; // 40-100
                }
            } else {
                // 상대방의 경우에만 컨디션 확인 및 부여 (유효한 컨디션이 없을 때만)
                if (p2.condition === undefined || p2.condition === null || p2.condition === 1000 || 
                    p2.condition < 40 || p2.condition > 100) {
                    p2.condition = Math.floor(Math.random() * 61) + 40; // 40-100
                }
            }
        }
    }
    
    // Fluctuate stats every second
    const playersToUpdate = [p1, p2];
    for (const player of playersToUpdate) {
        if (!player) continue;
        
        // Select one random stat to fluctuate
        const allStats = Object.values(CoreStat);
        const statToFluctuate = allStats[Math.floor(Math.random() * allStats.length)];

        const condition = player.condition || 100;
        // 양수값이 나올 기본확률 -30% + 컨디션%
        // 예: 컨디션 50 = -30% + 50% = 20% 양수 확률
        // 예: 컨디션 100 = -30% + 100% = 70% 양수 확률
        const positiveChangeProbability = (condition - 30) / 100;
        
        let fluctuation: number;
        if (Math.random() < positiveChangeProbability) {
            // Positive fluctuation: 1, 2, or 3
            fluctuation = Math.floor(Math.random() * 3) + 1;
        } else {
            // Negative fluctuation: -1, -2, or -3
            fluctuation = Math.floor(Math.random() * 3) - 3;
        }
        player.stats[statToFluctuate] = (player.stats[statToFluctuate] || 0) + fluctuation;
    }

    // 현재 시간에 맞는 단계 결정 (초반: 1-15초, 중반: 16-35초, 종반: 36-50초)
    const phase = getPhase(state.timeElapsed);
    
    // 각 단계에 필요한 능력치의 가중치 합계를 계산
    // 초반: 전투력*0.4 + 사고속도*0.3 + 집중력*0.3
    // 중반: 전투력*0.3 + 판단력*0.3 + 집중력*0.2 + 안정감*0.2
    // 종반: 계산력*0.5 + 안정감*0.3 + 집중력*0.2
    const p1BasePower = calculatePower(p1, phase);
    const p2BasePower = calculatePower(p2, phase);

    // ±10% 랜덤 변동 적용
    const p1RandomFactor = 1 + (Math.random() * 0.2 - 0.1); // 0.9 ~ 1.1
    const p2RandomFactor = 1 + (Math.random() * 0.2 - 0.1); // 0.9 ~ 1.1
    const p1PowerWithRandom = p1BasePower * p1RandomFactor;
    const p2PowerWithRandom = p2BasePower * p2RandomFactor;

    // 크리티컬 확률 계산: 기본 15% + (판단력 x (0.03~0.1사이랜덤))%
    const p1Judgment = p1.stats[CoreStat.Judgment] || 0;
    const p2Judgment = p2.stats[CoreStat.Judgment] || 0;
    const p1CritMultiplier = 0.03 + Math.random() * 0.07; // 0.03 ~ 0.1
    const p2CritMultiplier = 0.03 + Math.random() * 0.07; // 0.03 ~ 0.1
    const p1CritChance = 15 + (p1Judgment * p1CritMultiplier);
    const p2CritChance = 15 + (p2Judgment * p2CritMultiplier);

    // 크리티컬 발생 여부 확인
    const p1IsCritical = Math.random() * 100 < p1CritChance;
    const p2IsCritical = Math.random() * 100 < p2CritChance;

    // 크리티컬 점수 계산: 더해지는 점수 + 더해지는 점수의 (((전투력 x 0.1)+(계산력 x 0.5)%)+랜덤(±50)%)
    let p1FinalPower = p1PowerWithRandom;
    let p2FinalPower = p2PowerWithRandom;

    if (p1IsCritical) {
        const p1CombatPower = p1.stats[CoreStat.CombatPower] || 0;
        const p1Calculation = p1.stats[CoreStat.Calculation] || 0;
        const p1CritBonusPercent = (p1CombatPower * 0.1) + (p1Calculation * 0.5) + (Math.random() * 100 - 50); // ±50% 랜덤
        p1FinalPower = p1PowerWithRandom + (p1PowerWithRandom * p1CritBonusPercent / 100);
    }

    if (p2IsCritical) {
        const p2CombatPower = p2.stats[CoreStat.CombatPower] || 0;
        const p2Calculation = p2.stats[CoreStat.Calculation] || 0;
        const p2CritBonusPercent = (p2CombatPower * 0.1) + (p2Calculation * 0.5) + (Math.random() * 100 - 50); // ±50% 랜덤
        p2FinalPower = p2PowerWithRandom + (p2PowerWithRandom * p2CritBonusPercent / 100);
    }

    // 매초 각 단계별 능력치 점수를 누적하여 그래프 점수 계산
    const p1Cumulative = (state.currentMatchScores?.player1 || 0) + p1FinalPower;
    const p2Cumulative = (state.currentMatchScores?.player2 || 0) + p2FinalPower;
    state.currentMatchScores = { player1: p1Cumulative, player2: p2Cumulative };
    
    // 클라이언트 애니메이션을 위한 점수 증가 정보 저장
    state.lastScoreIncrement = {
        player1: {
            base: p1BasePower,
            actual: p1FinalPower,
            isCritical: p1IsCritical
        },
        player2: {
            base: p2BasePower,
            actual: p2FinalPower,
            isCritical: p2IsCritical
        }
    };
    
    const totalCumulative = p1Cumulative + p2Cumulative;
    const p1ScorePercent = totalCumulative > 0 ? (p1Cumulative / totalCumulative) * 100 : 50;

    // Commentary system: 1 second interval
    if (state.timeElapsed === 1) {
        // 초반전 시작 메시지
        state.currentMatchCommentary.push({ text: `초반전이 시작되었습니다. (필요능력치: 전투력, 사고속도, 집중력)`, phase: 'early', isRandomEvent: false });
        state.currentMatchCommentary.push({ text: COMMENTARY_POOLS.start.replace('{p1}', p1.nickname).replace('{p2}', p2.nickname), phase: 'early', isRandomEvent: false });
    } else if (state.timeElapsed === EARLY_GAME_DURATION + 1) {
        // 중반전 시작 메시지
        state.currentMatchCommentary.push({ text: `중반전이 시작되었습니다. (필요능력치: 전투력, 판단력, 집중력, 안정감)`, phase: 'mid', isRandomEvent: false });
    } else if (state.timeElapsed === EARLY_GAME_DURATION + MID_GAME_DURATION + 1) {
        // 종반전 시작 메시지
        state.currentMatchCommentary.push({ text: `종반전이 시작되었습니다. (필요능력치: 계산력, 안정감, 집중력)`, phase: 'end', isRandomEvent: false });
    } else if (state.timeElapsed % 10 === 0 && state.timeElapsed > 0 && state.timeElapsed < TOTAL_GAME_DURATION) {
        // Intermediate score every 10 seconds
        const leadPercent = Math.abs(p1ScorePercent - 50) * 2;
        const scoreDiff = (leadPercent / 2);
        const roundedDiff = Math.round(scoreDiff);
        const finalDiff = roundedDiff + 0.5;
        const leader = p1ScorePercent > 50 ? p1.nickname : p2.nickname;
        if (finalDiff > 0.5) {
            state.currentMatchCommentary.push({ text: `[중간 스코어] ${leader} 선수 ${finalDiff.toFixed(1)}집 우세.`, phase, isRandomEvent: false });
        }
    } else if (state.timeElapsed > 1 && state.timeElapsed < TOTAL_GAME_DURATION) {
        // Commentary every second (except at 10s intervals and random events)
        const pool = COMMENTARY_POOLS[phase];
        
        // Get the text of the last few comments to avoid repetition.
        const recentComments = state.currentMatchCommentary.slice(-3).map(c => c.text);
        
        let newCommentText;
        if (pool.length > 1) {
            let attempts = 0;
            let candidateText;
            do {
                candidateText = pool[Math.floor(Math.random() * pool.length)];
                candidateText = candidateText.replace('{p1}', p1.nickname).replace('{p2}', p2.nickname);
                attempts++;
            } while (recentComments.includes(candidateText) && attempts < 10);
            newCommentText = candidateText;
        } else {
            newCommentText = pool[0].replace('{p1}', p1.nickname).replace('{p2}', p2.nickname);
        }

        state.currentMatchCommentary.push({ text: newCommentText, phase, isRandomEvent: false });
    }

    // Random events every 5 seconds (경기 종료 직전 마지막 5초에는 발동하지 않음)
    // 경기 시작 후 1초부터 경기 종료 5초 전까지만 발동
    const RANDOM_EVENT_STOP_TIME = TOTAL_GAME_DURATION - 5;
    if (state.timeElapsed > 1 && state.timeElapsed <= RANDOM_EVENT_STOP_TIME && state.timeElapsed % 5 === 0) {
        // 30% 확률로 이벤트 발생 여부 결정
        if (Math.random() < 0.30) {
            const events = [
                { type: CoreStat.Concentration, isPositive: false, text: "{player}님이 조급한 마음에 실수가 나왔습니다." },
                { type: CoreStat.ThinkingSpeed, isPositive: true, text: "{player}님이 시간 압박에서도 좋은 수를 둡니다." },
                { type: CoreStat.CombatPower, isPositive: true, text: "{player}님이 공격적인 수로 판세를 흔듭니다." },
                { type: CoreStat.Stability, isPositive: true, text: "{player}님이 차분하게 받아치며 불리한 싸움을 버팁니다." },
            ];
            
            // 각 이벤트에 대해 플레이어별 확률 계산
            const eventOptions: Array<{ event: typeof events[0]; player: PlayerForTournament; weight: number }> = [];
            
            for (const event of events) {
                const p1Stat = p1.stats[event.type] || 100;
                const p2Stat = p2.stats[event.type] || 100;
                
                // 능력치 차이 계산
                const totalStat = p1Stat + p2Stat;
                const statDiff = Math.abs(p1Stat - p2Stat);
                const statDiffPercent = totalStat > 0 ? (statDiff / totalStat) * 100 : 0;
                
                // 각 플레이어별로 이벤트 발생 확률 계산
                if (event.isPositive) {
                    // 긍정 이벤트: 능력치가 높은 플레이어에게 발생
                    if (p1Stat > p2Stat) {
                        // p1이 높으면 p1에게 긍정 이벤트 발생 확률이 높음
                        const p1Weight = 50 + (statDiffPercent / 2); // 능력치 차이에 따라 50~100% 범위
                        eventOptions.push({ event, player: p1, weight: p1Weight });
                    } else if (p2Stat > p1Stat) {
                        // p2가 높으면 p2에게 긍정 이벤트 발생 확률이 높음
                        const p2Weight = 50 + (statDiffPercent / 2);
                        eventOptions.push({ event, player: p2, weight: p2Weight });
                    } else {
                        // 능력치가 같으면 50% 확률
                        eventOptions.push({ event, player: p1, weight: 50 });
                        eventOptions.push({ event, player: p2, weight: 50 });
                    }
                } else {
                    // 부정 이벤트: 능력치가 낮은 플레이어에게 발생
                    if (p1Stat < p2Stat) {
                        // p1이 낮으면 p1에게 부정 이벤트 발생 확률이 높음
                        const p1Weight = 50 + (statDiffPercent / 2); // 능력치 차이에 따라 50~100% 범위
                        eventOptions.push({ event, player: p1, weight: p1Weight });
                    } else if (p2Stat < p1Stat) {
                        // p2가 낮으면 p2에게 부정 이벤트 발생 확률이 높음
                        const p2Weight = 50 + (statDiffPercent / 2);
                        eventOptions.push({ event, player: p2, weight: p2Weight });
                    } else {
                        // 능력치가 같으면 50% 확률
                        eventOptions.push({ event, player: p1, weight: 50 });
                        eventOptions.push({ event, player: p2, weight: 50 });
                    }
                }
            }
            
            // 가중치 기반으로 이벤트 선택 (반드시 하나 선택)
            const totalWeight = eventOptions.reduce((sum, opt) => sum + opt.weight, 0);
            let random = Math.random() * totalWeight;
            let selectedOption = eventOptions[0];
            
            for (const option of eventOptions) {
                if (random <= option.weight) {
                    selectedOption = option;
                    break;
                }
                random -= option.weight;
            }
            
            const { event, player: playerForEvent } = selectedOption;
            
            // 선택된 이벤트가 발생
            let triggeredMessage = event.text.replace('{player}', playerForEvent.nickname);
            const isMistake = !event.isPositive;

            const randomPercent = Math.random() * 8 + 2; // 2% to 10%
            const points = Math.round(randomPercent / 2); // 2% per point, rounded
            
            // Calculate score change as percentage of current total
            const currentTotal = (state.currentMatchScores?.player1 || 0) + (state.currentMatchScores?.player2 || 0);
            const scoreChange = currentTotal * (randomPercent / 100);
            
            triggeredMessage += ` (${isMistake ? '-' : '+'}${points}집)`;
            
            if (state.currentMatchScores) {
                if (playerForEvent.id === p1.id) {
                    state.currentMatchScores.player1 += isMistake ? -scoreChange : scoreChange;
                } else {
                    state.currentMatchScores.player2 += isMistake ? -scoreChange : scoreChange;
                }
            }
            
            // 랜덤 이벤트로 인한 점수 변화를 lastScoreIncrement에 추가
            if (state.lastScoreIncrement) {
                if (playerForEvent.id === p1.id) {
                    // 기존 점수 증가에 랜덤 이벤트 점수 변화 추가
                    state.lastScoreIncrement.player1 = {
                        base: state.lastScoreIncrement.player1?.base || 0,
                        actual: (state.lastScoreIncrement.player1?.actual || 0) + (isMistake ? -scoreChange : scoreChange),
                        isCritical: state.lastScoreIncrement.player1?.isCritical || false
                    };
                } else {
                    state.lastScoreIncrement.player2 = {
                        base: state.lastScoreIncrement.player2?.base || 0,
                        actual: (state.lastScoreIncrement.player2?.actual || 0) + (isMistake ? -scoreChange : scoreChange),
                        isCritical: state.lastScoreIncrement.player2?.isCritical || false
                    };
                }
            } else {
                // lastScoreIncrement가 없으면 새로 생성
                state.lastScoreIncrement = {
                    player1: playerForEvent.id === p1.id ? {
                        base: 0,
                        actual: isMistake ? -scoreChange : scoreChange,
                        isCritical: false
                    } : null,
                    player2: playerForEvent.id === p2.id ? {
                        base: 0,
                        actual: isMistake ? -scoreChange : scoreChange,
                        isCritical: false
                    } : null
                };
            }
            
            state.currentMatchCommentary.push({ text: triggeredMessage, phase, isRandomEvent: true });
        }
    }
    
    if (state.timeElapsed >= TOTAL_GAME_DURATION) {
        // 최종 점수 계산 (최신 currentMatchScores 사용)
        const finalP1Cumulative = state.currentMatchScores?.player1 || p1Cumulative;
        const finalP2Cumulative = state.currentMatchScores?.player2 || p2Cumulative;
        const totalFinalScore = finalP1Cumulative + finalP2Cumulative;
        const finalP1ScorePercent = totalFinalScore > 0 ? (finalP1Cumulative / totalFinalScore) * 100 : 50;
        
        const { finalCommentary, winner } = finishMatch(match, p1, p2, finalP1Cumulative, finalP2Cumulative);
        
        state.currentMatchCommentary.push(...finalCommentary);
        
        match.winner = winner;
        match.isFinished = true;
        match.commentary = [...state.currentMatchCommentary];
        match.finalScore = { player1: finalP1ScorePercent, player2: 100 - finalP1ScorePercent };
        
        processMatchCompletion(state, user, match, roundIndex);
    }

    return true;
};

// 서버에서 시뮬레이션을 실행하여 클라이언트 결과를 검증하는 함수
export const runServerSimulation = async (
    seed: string,
    p1: PlayerForTournament,
    p2: PlayerForTournament
): Promise<{ player1Score: number; player2Score: number; commentary: CommentaryLine[]; winnerId: string }> => {
    // SeededRandom 클래스를 동적으로 import
    // 클라이언트와 동일한 시뮬레이션 로직 사용
    // ESM 환경에서는 동적 import 사용
    const tournamentSimulationModule = await import('../utils/tournamentSimulation.js');
    const { runClientSimulation } = tournamentSimulationModule;
    
    // 클라이언트와 동일한 시뮬레이션 실행
    const result = runClientSimulation(seed, p1, p2);
    
    return {
        player1Score: result.player1Score,
        player2Score: result.player2Score,
        commentary: result.commentary,
        winnerId: result.winnerId
    };
};

export const calculateRanks = (tournament: TournamentState): { id: string, nickname: string, rank: number }[] => {
    if (!tournament || !tournament.type || !tournament.players || !tournament.rounds) {
        console.error(`[calculateRanks] Invalid tournament state:`, tournament);
        throw new Error('Invalid tournament state');
    }
    
    const definition = TOURNAMENT_DEFINITIONS[tournament.type];
    if (!definition) {
        console.error(`[calculateRanks] Tournament definition not found for type:`, tournament.type);
        throw new Error(`Tournament definition not found for type: ${tournament.type}`);
    }
    
    const players = tournament.players;
    if (!Array.isArray(players) || players.length === 0) {
        console.error(`[calculateRanks] Invalid players array:`, players);
        throw new Error('Invalid players array');
    }
    
    const rankedPlayers: { id: string, nickname: string, rank: number }[] = [];

    if (definition.format === 'round-robin') {
        const wins: Record<string, number> = {};
        players.forEach(p => { wins[p.id] = 0; });

        tournament.rounds.forEach(round => {
            round.matches.forEach(match => {
                if (match.winner) {
                    wins[match.winner.id]++;
                }
            });
        });

        const sortedPlayers = [...players].sort((a, b) => wins[b.id] - wins[a.id]);
        
        let currentRank = 1;
        for (let i = 0; i < sortedPlayers.length; i++) {
            const player = sortedPlayers[i];
            if (i > 0 && wins[player.id] < wins[sortedPlayers[i - 1].id]) {
                currentRank = i + 1;
            }
            rankedPlayers.push({ id: player.id, nickname: player.nickname, rank: currentRank });
        }
    } else { // tournament
        const playerRanks: Map<string, number> = new Map();
        const rankedPlayerIds = new Set<string>();

        for (let i = tournament.rounds.length - 1; i >= 0; i--) {
            const round = tournament.rounds[i];
            if (!round || !round.matches || round.matches.length === 0) continue;
            
            round.matches.forEach(match => {
                if (match.isFinished && match.winner && match.players[0] && match.players[1]) {
                    const loser = match.winner.id === match.players[0].id ? match.players[1] : match.players[0];
                    if (loser && !rankedPlayerIds.has(loser.id)) {
                        let rank = 0;
                        if(round.name.includes("강")) {
                            const roundNum = parseInt(round.name.replace("강",""));
                            if (!isNaN(roundNum)) {
                                rank = roundNum;
                            }
                        } else if(round.name.includes("결승")) {
                            rank = 2;
                        } else if(round.name.includes("3,4위전") || round.name.includes("3/4위전")) {
                            // 3/4위전에서 패배한 경우 4위, 승리한 경우 3위
                            if (match.winner.id === loser.id) {
                                rank = 3; // 이 경우는 발생하지 않아야 하지만 안전을 위해
                            } else {
                                rank = 4;
                            }
                        }
                        if (rank > 0) {
                            playerRanks.set(loser.id, rank);
                            rankedPlayerIds.add(loser.id);
                        }
                    }
                }
            });
        }
        
        // 결승전 우승자 찾기
        const finalRound = tournament.rounds.find(r => r.name === '결승');
        if (finalRound && finalRound.matches && finalRound.matches.length > 0) {
            const finalMatch = finalRound.matches[0];
            if (finalMatch && finalMatch.winner && finalMatch.isFinished) {
                playerRanks.set(finalMatch.winner.id, 1);
                rankedPlayerIds.add(finalMatch.winner.id);
            }
        }
        
        // 3/4위전 승자 찾기
        const thirdPlaceRound = tournament.rounds.find(r => r.name === '3,4위전' || r.name === '3/4위전');
        if (thirdPlaceRound && thirdPlaceRound.matches && thirdPlaceRound.matches.length > 0) {
            thirdPlaceRound.matches.forEach(match => {
                if (match.isFinished && match.winner && !rankedPlayerIds.has(match.winner.id)) {
                    playerRanks.set(match.winner.id, 3);
                    rankedPlayerIds.add(match.winner.id);
                }
            });
        }
        
        players.forEach(p => {
            if (playerRanks.has(p.id)) {
                rankedPlayers.push({ id: p.id, nickname: p.nickname, rank: playerRanks.get(p.id)! });
            }
        });
        rankedPlayers.sort((a,b) => a.rank - b.rank);
    }
    return rankedPlayers;
};

// === 던전 시스템 함수 ===

/**
 * 던전 단계별 봇 생성
 * @param stage 단계 (1~10)
 * @param dungeonType 던전 타입 (neighborhood/national/world)
 * @param botId 봇 ID
 * @param botName 봇 이름
 * @param botAvatar 봇 아바타
 * @param botBorder 봇 테두리
 * @returns PlayerForTournament 객체
 */
export const createDungeonStageBot = (
    stage: number,
    dungeonType: TournamentType,
    botId: string,
    botName: string,
    botAvatar: { id: string },
    botBorder: { id: string }
): PlayerForTournament => {
    // 단계별 능력치 범위 가져오기 (stage가 유효한지 확인)
    if (!stage || stage < 1 || stage > 10) {
        console.warn(`[createDungeonStageBot] Invalid stage: ${stage}, using stage 1 as fallback`);
        stage = 1;
    }
    
    const stageStats = DUNGEON_STAGE_BOT_STATS[stage] || DUNGEON_STAGE_BOT_STATS[1];
    
    if (!stageStats) {
        console.error(`[createDungeonStageBot] No stats found for stage ${stage}, using stage 1 stats`);
        const fallbackStats = DUNGEON_STAGE_BOT_STATS[1];
        if (!fallbackStats) {
            throw new Error(`[createDungeonStageBot] No stats found for stage 1, check DUNGEON_STAGE_BOT_STATS configuration`);
        }
    }
    
    console.log(`[createDungeonStageBot] Creating bot for stage ${stage}, stats range: ${stageStats.minStat}-${stageStats.maxStat}`);
    
    // 각 능력치를 독립적으로 단계별 범위에서 생성 (던전 타입 배율 없이 1.0으로 통일)
    const baseStats: Record<CoreStat, number> = {} as any;
    
    // 각 능력치를 minStat~maxStat 범위에서 랜덤 생성
    for (const stat of Object.values(CoreStat)) {
        const baseValue = Math.floor(Math.random() * (stageStats.maxStat - stageStats.minStat + 1)) + stageStats.minStat;
        baseStats[stat] = baseValue;
    }
    
    console.log(`[createDungeonStageBot] Bot ${botName} (stage ${stage}) created with stats:`, baseStats);
    
    // 컨디션 랜덤 설정 (40~100)
    const condition = Math.floor(Math.random() * 61) + 40;
    
    // PlayerForTournament 객체 생성
    const bot: PlayerForTournament = {
        id: botId,
        nickname: botName,
        avatarId: botAvatar.id,
        borderId: botBorder.id,
        league: 'Sprout' as any, // 던전에서는 리그 정보가 필요 없음
        stats: baseStats,
        originalStats: JSON.parse(JSON.stringify(baseStats)),
        condition,
        wins: 0,
        losses: 0,
    };
    
    return bot;
};

/**
 * 던전 단계 시뮬레이션 (유저 vs 봇)
 * @param user 유저 PlayerForTournament
 * @param bot 봇 PlayerForTournament
 * @returns 시뮬레이션 결과 (승자, 점수차이 등)
 */
export const simulateDungeonStage = (
    user: PlayerForTournament,
    bot: PlayerForTournament
): { winner: PlayerForTournament; scoreDiff: number; userPercent: number; botPercent: number } => {
    // 능력치를 원래 값으로 리셋
    if (user.originalStats) {
        user.stats = JSON.parse(JSON.stringify(user.originalStats));
    }
    if (bot.originalStats) {
        bot.stats = JSON.parse(JSON.stringify(bot.originalStats));
    }
    
    let userCumulativeScore = 0;
    let botCumulativeScore = 0;
    
    // 각 단계별로 능력치 계산
    for (let t = 1; t <= TOTAL_GAME_DURATION; t++) {
        const phase = getPhase(t);
        userCumulativeScore += calculatePower(user, phase);
        botCumulativeScore += calculatePower(bot, phase);
    }
    
    // 승자 결정
    const totalScore = userCumulativeScore + botCumulativeScore;
    const userPercent = totalScore > 0 ? (userCumulativeScore / totalScore) * 100 : 50;
    const botPercent = 100 - userPercent;
    
    const diffPercent = Math.abs(userPercent - 50) * 2;
    const scoreDiff = (diffPercent / 2);
    const roundedDiff = Math.round(scoreDiff);
    const finalDiff = roundedDiff + 0.5;
    
    let winner: PlayerForTournament;
    if (finalDiff < 0.5) {
        // 거의 비김 - 랜덤으로 결정
        winner = Math.random() < 0.5 ? user : bot;
    } else {
        winner = userPercent > 50 ? user : bot;
    }
    
    // 점수차이 계산 (랭킹 정렬용)
    const actualScoreDiff = winner.id === user.id ? finalDiff : -finalDiff;
    
    return {
        winner,
        scoreDiff: actualScoreDiff,
        userPercent,
        botPercent,
    };
};

