import React from 'react';
import DraggableWindow from './DraggableWindow.js';
import { TOURNAMENT_LOBBY_IMG } from '../assets.js';

interface ChampionshipHelpModalProps {
    onClose: () => void;
    isTopmost?: boolean;
}

const ChampionshipHelpModal: React.FC<ChampionshipHelpModalProps> = ({ onClose, isTopmost }) => {
    return (
        <DraggableWindow title="챔피언십 도움말" onClose={onClose} windowId="championship-help" initialWidth={700} isTopmost={isTopmost}>
            <div className="max-h-[70vh] overflow-y-auto pr-2 text-gray-300">
                <div className="space-y-4">
                    <div className="flex items-start gap-4 bg-gray-900/50 p-4 rounded-lg">
                        <img src={TOURNAMENT_LOBBY_IMG} alt="챔피언십" className="w-32 h-32 object-cover rounded-lg flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-yellow-300 mb-2">챔피언십 개요</h3>
                            <p className="text-sm mb-2">
                                챔피언십은 던전 시스템으로 운영됩니다. 각 경기장(동네바둑리그, 전국바둑대회, 월드챔피언십)마다 1단계부터 10단계까지의 단계가 있으며, 
                                각 단계에서 봇들과 리그/토너먼트를 진행하여 순위를 결정합니다.
                            </p>
                            <p className="text-sm mb-2">
                                <strong className="text-yellow-400">다음 단계 언락 조건:</strong> 해당 단계에서 3등 이상 달성 시 다음 단계가 열립니다.
                            </p>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 bg-gray-900/50 p-4 rounded-lg">
                        <img src="/images/championship/Champ1.png" alt="동네바둑리그" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-yellow-300 mb-2">동네바둑리그</h3>
                            <ul className="list-disc list-inside space-y-1 text-sm">
                                <li>골드 획득이 가능한 던전입니다</li>
                                <li>각 단계에서 6명의 플레이어(유저 + 5봇)가 풀리그 방식으로 진행</li>
                                <li>5회차로 나누어 진행, 각 회차마다 다른 상대와 경기</li>
                                <li>승리 횟수에 따라 순위 결정 (1등~6등)</li>
                                <li>순위에 따라 골드 꾸러미 보상 지급</li>
                                <li><strong className="text-yellow-400">3등 이상 달성 시 다음 단계 언락</strong></li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 bg-gray-900/50 p-4 rounded-lg">
                        <img src="/images/championship/Champ2.png" alt="전국바둑대회" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-yellow-300 mb-2">전국바둑대회</h3>
                            <ul className="list-disc list-inside space-y-1 text-sm">
                                <li>강화석(재료) 획득이 가능한 던전입니다</li>
                                <li>각 단계에서 8명의 플레이어(유저 + 7봇)가 토너먼트 방식으로 진행</li>
                                <li>8강, 4강, 결승으로 진행되며 승리 시 다음 라운드 진출, 패배 시 탈락</li>
                                <li>최종 순위에 따라 재료 상자 보상 지급</li>
                                <li><strong className="text-yellow-400">3등 이상 달성 시 다음 단계 언락</strong></li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex items-start gap-3 bg-gray-900/50 p-4 rounded-lg">
                        <img src="/images/championship/Champ3.png" alt="월드챔피언십" className="w-16 h-16 object-cover rounded-lg flex-shrink-0" />
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-yellow-300 mb-2">월드챔피언십</h3>
                            <ul className="list-disc list-inside space-y-1 text-sm">
                                <li>장비 상자 및 변경권 획득이 가능한 던전입니다</li>
                                <li>각 단계에서 16명의 플레이어(유저 + 15봇)가 토너먼트 방식으로 진행</li>
                                <li>16강, 8강, 4강, 결승으로 진행되며 승리 시 다음 라운드 진출, 패배 시 탈락</li>
                                <li>최종 순위에 따라 다이아 꾸러미 보상 지급</li>
                                <li><strong className="text-yellow-400">3등 이상 달성 시 다음 단계 언락</strong></li>
                            </ul>
                        </div>
                    </div>

                    <div className="flex items-start gap-4 bg-gray-900/50 p-4 rounded-lg">
                        <div className="flex-1">
                            <h3 className="font-bold text-lg text-yellow-300 mb-2">경기장 공통 특징</h3>
                            <div className="space-y-3 text-sm">
                                <div>
                                    <h4 className="font-semibold text-yellow-200 mb-1">시뮬레이션 경기</h4>
                                    <ul className="list-disc list-inside space-y-1 ml-2">
                                        <li>50초 동안 진행, 초반/중반/종반으로 나뉨</li>
                                        <li>초반 능력: 전투력, 사고속도, 집중력</li>
                                        <li>중반 능력: 전투력, 판단력, 집중력, 안정감</li>
                                        <li>종반 능력: 계산력, 안정감, 집중력</li>
                                        <li>5초마다 30% 확률로 랜덤 이벤트 발생</li>
                                        <li>치명타 발생 시 추가 점수 획득</li>
                                    </ul>
                                </div>
                                <div>
                                    <h4 className="font-semibold text-yellow-200 mb-1">컨디션</h4>
                                    <ul className="list-disc list-inside space-y-1 ml-2">
                                        <li>각 경기/라운드 전에 40~100 사이의 랜덤 컨디션 부여</li>
                                        <li>컨디션이 낮을수록 능력치가 불안정하게 변동</li>
                                        <li>컨디션 회복제로 회복 가능 (상점 구매 또는 퀘스트 보상)</li>
                                    </ul>
                                </div>
                                <div>
                                    <h4 className="font-semibold text-yellow-200 mb-1">보상</h4>
                                    <ul className="list-disc list-inside space-y-1 ml-2">
                                        <li><strong className="text-yellow-300">기본 보상:</strong> 각 경기마다 승/패에 따라 골드, 강화석, 장비상자가 자동으로 지급됩니다</li>
                                        <li><strong className="text-yellow-300">순위 보상:</strong> 토너먼트 완료 시 최종 순위에 따라 추가 보상이 지급됩니다</li>
                                        <li><strong className="text-yellow-300">동네바둑리그:</strong> 골드 꾸러미 (순위가 높을수록 더 많은 골드)</li>
                                        <li><strong className="text-yellow-300">전국바둑대회:</strong> 재료 상자 (순위가 높을수록 더 높은 등급의 재료 상자)</li>
                                        <li><strong className="text-yellow-300">월드챔피언십:</strong> 다이아 꾸러미 (순위가 높을수록 더 많은 다이아 꾸러미)</li>
                                        <li><strong className="text-yellow-300">일일 점수:</strong> 단계별 기본 점수와 순위 보너스를 합산하여 챔피언십 점수 획득</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default ChampionshipHelpModal;
