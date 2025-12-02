import React, { useState } from 'react';
import { TOURNAMENT_SCORE_REWARDS, DUNGEON_STAGE_BASE_SCORE, DUNGEON_RANK_SCORE_BONUS } from '../constants';
import { TournamentType } from '../types';

const PointsInfoPanel: React.FC = () => {
    const [selectedStage, setSelectedStage] = useState<number>(1);
    const tournamentTypes: { type: TournamentType; arena: string; title: string }[] = [
        { type: 'neighborhood', arena: '동네', title: '동네바둑리그' },
        { type: 'national', arena: '전국', title: '전국바둑대회' },
        { type: 'world', arena: '세계', title: '월드챔피언십' }
    ];

    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    
    // 단계별 기본 점수
    const baseScore = DUNGEON_STAGE_BASE_SCORE[selectedStage] || 0;
    
    // 각 경기장별 순위별 점수 계산
    const calculateStageScore = (tournamentType: TournamentType, rank: number): number => {
        const base = baseScore;
        const bonus = DUNGEON_RANK_SCORE_BONUS[rank] || DUNGEON_RANK_SCORE_BONUS[10] || 0;
        return Math.floor(base * (1 + bonus));
    };
    
    return (
        <div className="bg-gray-800/50 rounded-lg p-2 sm:p-3 h-full flex flex-col">
            <h3 className={`${isMobile ? 'text-xs' : 'text-base'} font-bold text-center ${isMobile ? 'mb-1.5' : 'mb-3'} flex-shrink-0`}>일일 획득 가능 점수</h3>
            
            {/* 단계 선택 드롭다운 */}
            <div className={`${isMobile ? 'mb-1.5' : 'mb-3'} flex-shrink-0`}>
                <label className={`${isMobile ? 'text-[10px]' : 'text-xs'} text-gray-300 mb-1 block`}>단계 선택</label>
                <select
                    value={selectedStage}
                    onChange={(e) => setSelectedStage(Number(e.target.value))}
                    className={`bg-gray-700 border border-gray-600 ${isMobile ? 'text-[10px] p-1' : 'text-xs p-1.5'} rounded-md focus:ring-purple-500 focus:border-purple-500 w-full text-gray-200`}
                >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(stage => (
                        <option key={stage} value={stage}>{stage}단계</option>
                    ))}
                </select>
            </div>
            
            <div className="flex-grow overflow-y-auto pr-1 space-y-2 sm:space-y-3">
                {tournamentTypes.map(arenaData => {
                    // 던전 시스템에서는 순위별 점수를 단계별 기본 점수 + 순위 보너스로 계산
                    const maxRank = arenaData.type === 'neighborhood' ? 6 : arenaData.type === 'national' ? 8 : 16;
                    const ranks = Array.from({ length: maxRank }, (_, i) => i + 1);
                    
                    return (
                        <div key={arenaData.arena} className={`bg-gray-900/50 ${isMobile ? 'p-1.5' : 'p-2'} rounded-md shadow-inner`}>
                            <h4 className={`${isMobile ? 'text-[10px]' : 'text-sm'} font-bold text-accent ${isMobile ? 'mb-1' : 'mb-1.5'} border-b border-accent/50 ${isMobile ? 'pb-0.5' : 'pb-0.5'}`}>
                                {arenaData.title} ({selectedStage}단계)
                            </h4>
                            <div className={`grid grid-cols-2 ${isMobile ? 'gap-x-1 gap-y-0.5' : 'gap-x-2 gap-y-0.5'}`}>
                                {ranks.slice(0, 6).map(rank => {
                                    const points = calculateStageScore(arenaData.type, rank);
                                    const rankColor = rank === 1 ? 'text-yellow-400' : rank === 2 ? 'text-gray-400' : rank === 3 ? 'text-amber-600' : 'text-gray-300';
                                    return (
                                        <div key={rank} className={`flex justify-between items-center ${isMobile ? 'text-[9px]' : 'text-xs'}`}>
                                            <span className="font-semibold truncate">{rank}위</span>
                                            <span className={`font-bold ${rankColor} flex-shrink-0 ${isMobile ? 'ml-0.5' : 'ml-1'}`}>{points}점</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default PointsInfoPanel;
