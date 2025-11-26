import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useAppContext } from '../hooks/useAppContext.js';
import Button from './Button.js';
import Avatar from './Avatar.js';
import { UserWithStatus } from '../types.js';
import { AVATAR_POOL, BORDER_POOL, CONSUMABLE_ITEMS } from '../constants';
import { TOWER_STAGES } from '../constants/towerConstants.js';
import { TOWER_CHALLENGE_LOBBY_IMG } from '../assets.js';
import { getKSTDate, getKSTMonth, getKSTFullYear } from '../utils/timeUtils.js';
import QuickAccessSidebar from './QuickAccessSidebar.js';
import TowerItemShopModal from './TowerItemShopModal.js';

const TowerLobby: React.FC = () => {
        const { currentUser, currentUserWithStatus, allUsers, handlers } = useAppContext();
    const [isMobile, setIsMobile] = useState(window.innerWidth < 1024);
    const [isHelpOpen, setIsHelpOpen] = useState(false);
    const [isRewardModalOpen, setIsRewardModalOpen] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [isItemShopOpen, setIsItemShopOpen] = useState(false);
    const [timeUntilReset, setTimeUntilReset] = useState<string>('');
    const stageScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const checkIsMobile = () => setIsMobile(window.innerWidth < 1024);
        window.addEventListener('resize', checkIsMobile);
        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    // 다음 달 1일 0시(KST)까지 남은 시간 계산
    useEffect(() => {
        const updateTimeUntilReset = () => {
            const now = Date.now();
            const kstDate = getKSTDate(now);
            const kstYear = getKSTFullYear(now);
            const kstMonth = getKSTMonth(now);
            
            // 다음 달 1일 0시(KST)
            const nextMonth = kstMonth === 11 ? 0 : kstMonth + 1;
            const nextYear = kstMonth === 11 ? kstYear + 1 : kstYear;
            
            // KST 시간으로 다음 달 1일 0시 생성
            const resetDateKST = new Date(Date.UTC(nextYear, nextMonth, 1, 0, 0, 0, 0));
            // KST는 UTC+9이므로 UTC로 변환하려면 9시간 빼기
            const resetDateUTC = new Date(resetDateKST.getTime() - (9 * 60 * 60 * 1000));
            
            const diff = resetDateUTC.getTime() - now;
            
            if (diff <= 0) {
                setTimeUntilReset('초기화됨');
                return;
            }
            
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            
            if (days > 0) {
                setTimeUntilReset(`${days}일 ${hours}시간 ${minutes}분`);
            } else if (hours > 0) {
                setTimeUntilReset(`${hours}시간 ${minutes}분 ${seconds}초`);
            } else {
                setTimeUntilReset(`${minutes}분 ${seconds}초`);
            }
        };
        
        updateTimeUntilReset();
        const interval = setInterval(updateTimeUntilReset, 1000);
        return () => clearInterval(interval);
    }, []);

    const onBackToProfile = () => window.location.hash = '#/profile';

    if (!currentUser || !currentUserWithStatus) {
        return null;
    }

    // 랭킹 계산: 1층 이상 클리어한 사람만, 층수 높은 순, 같은 층이면 먼저 클리어한 순
    const { myRankingEntry, top100Users } = useMemo(() => {
        const allUsersList = Object.values(allUsers || {})
            .filter((user): user is UserWithStatus => {
                if (!user || user === null || user === undefined) return false;
                // 1층 이상 클리어한 사람만
                const towerFloor = (user as any).towerFloor ?? 0;
                return towerFloor > 0;
            });
        
        // 정렬: 층수 높은 순, 같은 층이면 먼저 클리어한 순 (lastTowerClearTime이 작을수록 먼저)
        const sortedUsers = allUsersList.sort((a, b) => {
            const floorA = (a as any).towerFloor ?? 0;
            const floorB = (b as any).towerFloor ?? 0;
            
            if (floorA !== floorB) {
                return floorB - floorA; // 층수 높은 순
            }
            
            // 같은 층이면 먼저 클리어한 순
            const timeA = (a as any).lastTowerClearTime ?? Infinity;
            const timeB = (b as any).lastTowerClearTime ?? Infinity;
            return timeA - timeB;
        });
        
        // 내 아이디 찾기
        const myEntry = sortedUsers.find(u => u.id === currentUser.id);
        const myRank = myEntry ? sortedUsers.findIndex(u => u.id === currentUser.id) + 1 : null;
        
        // Top 100 (내 아이디 제외)
        const top100 = sortedUsers
            .filter(u => u.id !== currentUser.id)
            .slice(0, 100);
        
        return {
            myRankingEntry: myEntry ? { ...myEntry, rank: myRank } : null,
            top100Users: top100
        };
    }, [allUsers, currentUser.id]);

    // 스테이지(층) 데이터 (1층부터 100층까지, 역순으로 표시하여 아래에서 위로 스크롤)
    const stages = Array.from({ length: 100 }, (_, i) => i + 1).reverse();

    // 스크롤을 아래쪽(1층)부터 시작하도록 설정
    useEffect(() => {
        if (stageScrollRef.current) {
            // 스크롤을 맨 아래(1층)로 설정
            stageScrollRef.current.scrollTop = stageScrollRef.current.scrollHeight;
        }
    }, []);

    return (
        <div className="w-full h-[calc(100vh-5rem)] flex flex-col relative text-white overflow-hidden" style={isMobile ? {
            backgroundImage: `url(${TOWER_CHALLENGE_LOBBY_IMG})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            backgroundRepeat: 'no-repeat'
        } : {
            background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 20%, #2d2419 40%, #3d2e1f 60%, #4a3a2a 80%, #5c4a35 100%)',
            backgroundSize: '400% 400%',
            animation: 'gradientShift 20s ease infinite'
        }}>
            <style>{`
                @keyframes gradientShift {
                    0% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                    100% { background-position: 0% 50%; }
                }
            `}</style>
            {/* 헤더: 뒤로가기, 타이틀, 도움말 */}
            <header className="flex-shrink-0 flex items-center justify-between px-2 sm:px-4 lg:px-6 py-3 sm:py-4 lg:py-5 bg-gradient-to-b from-black/60 via-amber-900/20 to-transparent backdrop-blur-sm border-b border-amber-600/40 shadow-[0_4px_20px_rgba(217,119,6,0.3)]">
                <button
                    onClick={onBackToProfile}
                    className="transition-transform active:scale-90 filter hover:drop-shadow-lg p-0 flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-lg hover:bg-amber-900/40 border border-amber-700/30"
                    aria-label="뒤로가기"
                >
                    <img src="/images/button/back.png" alt="Back" className="w-full h-full" />
                </button>
                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-yellow-300 to-amber-200 tracking-wider drop-shadow-[0_0_12px_rgba(217,119,6,0.9)]">
                    도전의 탑
                </h1>
                <button
                    onClick={() => setIsHelpOpen(!isHelpOpen)}
                    className="w-8 h-8 sm:w-10 sm:h-10 flex items-center justify-center transition-transform hover:scale-110"
                    aria-label="도움말"
                    title="도움말"
                >
                    <img src="/images/button/help.png" alt="도움말" className="w-full h-full" />
                </button>
            </header>

            {/* 도움말 모달 */}
            {isHelpOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
                    <div className="bg-gradient-to-br from-gray-900/95 via-amber-950/90 to-gray-800/95 border-2 border-amber-600/50 rounded-xl p-4 sm:p-6 max-w-md max-h-[80vh] overflow-y-auto shadow-2xl shadow-amber-900/50 backdrop-blur-md">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300">도전의 탑 도움말</h2>
                            <Button
                                onClick={() => setIsHelpOpen(false)}
                                colorScheme="none"
                                className="!p-1 !min-w-0 hover:bg-amber-900/50 rounded border border-amber-700/30"
                            >
                                <span className="text-xl text-amber-200">×</span>
                            </Button>
                        </div>
                        <div className="text-sm text-amber-100 space-y-2">
                            <p>도전의 탑은 100층으로 구성된 PvE 콘텐츠입니다.</p>
                            <p>각 층을 클리어하면 보상을 받을 수 있습니다.</p>
                            <p>랭킹은 클리어한 층 수와 시간으로 결정됩니다.</p>
                            <p className="text-amber-300 font-semibold mt-3">매월 1일 0시(KST)에 모든 층이 초기화됩니다.</p>
                        </div>
                    </div>
                </div>
            )}

            {/* 보상정보 모달 */}
            {isRewardModalOpen && (
                <div className="absolute inset-0 z-50 flex items-center justify-center">
                    <div className="bg-gradient-to-br from-gray-900/95 via-amber-950/90 to-gray-800/95 border-2 border-amber-600/50 rounded-xl p-4 sm:p-6 max-w-md max-h-[80vh] overflow-y-auto shadow-2xl shadow-amber-900/50 backdrop-blur-md">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300">보상정보</h2>
                            <Button
                                onClick={() => setIsRewardModalOpen(false)}
                                colorScheme="none"
                                className="!p-1 !min-w-0 hover:bg-amber-900/50 rounded border border-amber-700/30"
                            >
                                <span className="text-xl text-amber-200">×</span>
                            </Button>
                        </div>
                            <div className="text-sm text-amber-100 space-y-3">
                                <div>
                                    <h3 className="text-base font-bold text-yellow-300 mb-2">월간 보상 (매월 1일 0시 KST 지급)</h3>
                                    <p className="text-xs text-amber-200/80 mb-3">한 달 동안 클리어한 최고 층수에 따라 보상이 지급됩니다. (누적이 아닌 최고 층수만)</p>
                                    <div className="space-y-2 text-xs">
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-yellow-300 font-bold">100층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />10,000</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />100</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox6.png" alt="장비상자 VI" className="w-4 h-4" />장비상자6 ×2</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-gray-300 font-bold">90층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />7,500</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />75</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox6.png" alt="장비상자 VI" className="w-4 h-4" />장비상자6 ×1</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-amber-600 font-bold">80층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />5,000</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />50</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox5.png" alt="장비상자 V" className="w-4 h-4" />장비상자5 ×2</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-amber-300 font-bold">65층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />2,500</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />25</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox5.png" alt="장비상자 V" className="w-4 h-4" />장비상자5 ×1</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-amber-300 font-bold">50층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />1,500</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />20</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox4.png" alt="장비상자 IV" className="w-4 h-4" />장비상자4 ×1</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-amber-300 font-bold">35층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />1,000</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />15</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox3.png" alt="장비상자 III" className="w-4 h-4" />장비상자3 ×1</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-amber-300 font-bold">20층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />500</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />10</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox2.png" alt="장비상자 II" className="w-4 h-4" />장비상자2 ×1</span>
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2">
                                            <span className="min-w-[60px] text-amber-300 font-bold">10층</span>
                                            <div className="flex items-center gap-3 flex-wrap">
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Gold.png" alt="골드" className="w-4 h-4" />300</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/icon/Zem.png" alt="다이아몬드" className="w-4 h-4" />5</span>
                                                <span className="inline-flex items-center gap-1"><img src="/images/Box/EquipmentBox1.png" alt="장비상자 I" className="w-4 h-4" />장비상자1 ×1</span>
                                            </div>
                                        </div>
                                        <p className="text-amber-200/80 mt-2 text-[10px]">* 10층 미만 클리어 시 보상이 지급되지 않습니다.</p>
                                        <p className="text-amber-200/80 text-[10px]">* 보상은 매월 1일 0시(KST)에 메일로 지급되며, 30일 이내에 수령해주세요.</p>
                                    </div>
                                </div>
                                <div className="border-t border-amber-700/40 pt-3">
                                    <h3 className="text-base font-bold text-yellow-300 mb-2">층별 클리어 보상</h3>
                                    <div className="space-y-1 text-xs">
                                        <p>각 층을 클리어하면 골드와 경험치를 획득할 수 있습니다.</p>
                                        <p>높은 층일수록 더 많은 보상을 받을 수 있습니다.</p>
                                    </div>
                                </div>
                            </div>
                    </div>
                </div>
            )}

            {/* 모바일: 사이드바 버튼 */}
            {isMobile && (
                <div className="absolute top-1/2 -translate-y-1/2 right-0 z-30">
                    <button 
                        onClick={() => setIsMobileSidebarOpen(true)}
                        className="w-8 h-12 bg-secondary/80 backdrop-blur-sm rounded-l-lg flex items-center justify-center text-primary shadow-lg"
                        aria-label="메뉴 열기"
                    >
                        <span className="relative font-bold text-lg">{'<'}</span>
                    </button>
                </div>
            )}

            {/* 모바일: 사이드바 */}
            {isMobile && (
                <>
                    <div className={`fixed top-0 right-0 h-full w-[360px] bg-gradient-to-br from-gray-900/95 via-amber-950/90 to-gray-800/95 border-l-2 border-amber-600/50 shadow-2xl z-50 transition-transform duration-300 ease-in-out ${isMobileSidebarOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
                        <div className="flex justify-between items-center p-3 border-b border-amber-700/40 flex-shrink-0">
                            <h3 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300">메뉴</h3>
                            <button
                                onClick={() => setIsMobileSidebarOpen(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-amber-900/50 border border-amber-700/30"
                            >
                                <span className="text-xl text-amber-200">×</span>
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 space-y-3">
                            {/* 퀵메뉴 (가로 배치) */}
                            <div className="bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-2 backdrop-blur-md">
                                <QuickAccessSidebar mobile={true} />
                            </div>
                            
                            {/* 보유 아이템 패널 (가로 배치) */}
                            <div className="bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-2 backdrop-blur-md">
                                <h3 className="text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300 mb-2 text-center drop-shadow-[0_0_4px_rgba(217,119,6,0.8)]">
                                    보유 아이템
                                </h3>
                                <div className="flex flex-row gap-2 justify-center items-center">
                                    {(() => {
                                        const inventory = currentUserWithStatus?.inventory || [];
                                        const getItemCount = (itemName: string): number => {
                                            const item = inventory.find((inv: any) => inv.name === itemName || inv.id === itemName);
                                            return item?.quantity ?? 0;
                                        };
                                        const items = [
                                            { name: '턴 추가', icon: '/images/button/addturn.png', count: getItemCount('턴 추가') || getItemCount('addturn') },
                                            { name: '미사일', icon: '/images/button/missile.png', count: getItemCount('미사일') || getItemCount('missile') },
                                            { name: '히든', icon: '/images/button/hidden.png', count: getItemCount('히든') || getItemCount('hidden') },
                                            { name: '스캔', icon: '/images/button/scan.png', count: getItemCount('스캔') || getItemCount('scan') },
                                            { name: '배치변경', icon: '/images/button/reflesh.png', count: getItemCount('배치 새로고침') || getItemCount('배치변경') || getItemCount('reflesh') || getItemCount('refresh') }
                                        ];
                                        return items.map((item, index) => (
                                            <button
                                                key={index}
                                                className="flex flex-col items-center gap-1 bg-gray-800/40 border border-amber-700/30 rounded-lg p-2 hover:bg-gray-700/50 hover:border-amber-600/50 transition-colors flex-1"
                                                onClick={() => setIsItemShopOpen(true)}
                                            >
                                                <div className="relative w-10 h-10">
                                                    <img src={item.icon} alt={item.name} className="w-full h-full object-contain" />
                                                    <div className={`absolute -bottom-0.5 -right-0.5 text-[8px] font-bold rounded-full w-4 h-4 flex items-center justify-center border border-amber-900 ${
                                                        item.count > 0 ? 'bg-yellow-400 text-gray-900' : 'bg-gray-600 text-gray-300'
                                                    }`}>
                                                        {item.count}
                                                    </div>
                                                </div>
                                                <p className="text-[10px] font-semibold text-amber-100 text-center leading-tight">{item.name}</p>
                                            </button>
                                        ));
                                    })()}
                                </div>
                            </div>
                            
                            {/* 랭킹 보드 */}
                            <div className="bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-2 sm:p-3 flex flex-col min-h-0 overflow-hidden backdrop-blur-md">
                                <div className="flex items-center justify-between mb-2 flex-shrink-0">
                                    <div className="flex items-center gap-2">
                                        <h2 className="text-base sm:text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300 drop-shadow-[0_0_4px_rgba(217,119,6,0.8)]">
                                            랭킹 Top 100
                                        </h2>
                                        <span className="text-xs sm:text-sm font-semibold text-yellow-300">{timeUntilReset}</span>
                                    </div>
                                    <Button
                                        onClick={() => setIsRewardModalOpen(true)}
                                        colorScheme="none"
                                        className="!p-1.5 !min-w-0 border border-amber-600/50 bg-amber-900/40 hover:bg-amber-800/60 backdrop-blur-sm text-xs sm:text-sm text-amber-200"
                                    >
                                        보상정보
                                    </Button>
                                </div>
                                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                                    {myRankingEntry && (
                                        <div className="bg-gradient-to-r from-amber-800/50 to-yellow-800/50 border-2 border-amber-500/70 shadow-lg shadow-amber-700/50 rounded-lg p-2 mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className="text-xs sm:text-sm font-bold text-yellow-300 w-6 flex-shrink-0">
                                                    {myRankingEntry.rank}
                                                </span>
                                                <Avatar
                                                    userId={myRankingEntry.id}
                                                    userName={myRankingEntry.nickname}
                                                    avatarUrl={AVATAR_POOL.find(a => a.id === myRankingEntry.avatarId)?.url}
                                                    borderUrl={BORDER_POOL.find(b => b.id === myRankingEntry.borderId)?.url}
                                                    size={24}
                                                />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-xs sm:text-sm font-semibold truncate text-amber-100">{myRankingEntry.nickname}</p>
                                                    <p className="text-[10px] sm:text-xs text-amber-200">
                                                        층: {(myRankingEntry as any).towerFloor ?? 0}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {top100Users.length > 0 ? (
                                        top100Users.map((user, index) => {
                                            const avatarUrl = AVATAR_POOL.find(a => a.id === user.avatarId)?.url;
                                            const borderUrl = BORDER_POOL.find(b => b.id === user.borderId)?.url;
                                            const isTop3 = index < 3;
                                            const rank = index + 1;
                                            return (
                                                <div
                                                    key={user.id}
                                                    className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                                                        isTop3
                                                            ? 'bg-gradient-to-r from-amber-900/40 to-yellow-900/40 border border-amber-500/50 hover:from-amber-800/50 hover:to-yellow-800/50'
                                                            : 'bg-gray-800/40 border border-amber-700/30 hover:bg-gray-700/50 hover:border-amber-600/50'
                                                    }`}
                                                >
                                                    <span className={`text-xs sm:text-sm font-bold w-6 flex-shrink-0 ${
                                                        rank === 1 ? 'text-yellow-300' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-500' : 'text-amber-300'
                                                    }`}>
                                                        {rank}
                                                    </span>
                                                    <Avatar
                                                        userId={user.id}
                                                        userName={user.nickname}
                                                        avatarUrl={avatarUrl}
                                                        borderUrl={borderUrl}
                                                        size={24}
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-xs sm:text-sm font-semibold truncate text-amber-100">{user.nickname}</p>
                                                        <p className="text-[10px] sm:text-xs text-amber-300/80">
                                                            층: {(user as any).towerFloor ?? 0}
                                                        </p>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    ) : (
                                        <p className="text-center text-amber-300/60 py-8">랭킹 데이터가 없습니다.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                    {isMobileSidebarOpen && <div className="fixed inset-0 bg-black/60 z-40" onClick={() => setIsMobileSidebarOpen(false)}></div>}
                </>
            )}

            {/* 메인 레이아웃: 데스크톱 4개 패널 / 모바일 스테이지 패널 오버레이 */}
            {isMobile ? (
                /* 모바일: 스테이지 패널 오버레이 */
                <div className="flex-1 flex items-center justify-center p-4 min-h-0 overflow-hidden relative">
                    <div className="w-full max-w-md bg-gradient-to-br from-gray-900/50 via-amber-950/50 to-gray-800/50 border-2 border-amber-600/40 rounded-xl p-3 flex flex-col min-h-0 overflow-hidden backdrop-blur-md shadow-2xl" style={{ opacity: 0.5 }}>
                        <h2 className="text-base font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300 mb-3 flex-shrink-0 drop-shadow-[0_0_4px_rgba(217,119,6,0.8)]">
                            스테이지
                        </h2>
                        <div
                            ref={stageScrollRef}
                            className="flex-1 overflow-y-auto space-y-1.5 pr-1"
                        >
                            {stages.map((floor) => {
                                const stage = TOWER_STAGES.find(s => s.id === `tower-${floor}`);
                                const userTowerFloor = (currentUserWithStatus as any).towerFloor ?? 0;
                                const isCleared = floor <= userTowerFloor;
                                const isCurrent = floor === userTowerFloor + 1;
                                const actionPoints = currentUserWithStatus?.actionPoints?.current ?? 0;
                                const isAdmin = currentUser?.isAdmin ?? false;
                                const isLocked = !isAdmin && floor > 1 && floor > userTowerFloor + 1;
                                // 클리어한 층은 행동력 소모가 0
                                const effectiveActionPointCost = isCleared ? 0 : (stage?.actionPointCost ?? 0);
                                const canChallenge = !isLocked && actionPoints >= effectiveActionPointCost;
                                
                                if (!stage) return null;
                                
                                const reward = stage.rewards.firstClear;
                                const hasItemReward = reward.items && reward.items.length > 0;
                                
                                const getItemImage = (itemId: string): string => {
                                    const itemNameMap: Record<string, string> = {
                                        '장비상자1': '장비 상자 I', '장비상자2': '장비 상자 II', '장비상자3': '장비 상자 III',
                                        '장비상자4': '장비 상자 IV', '장비상자5': '장비 상자 V', '장비상자6': '장비 상자 VI',
                                        '재료상자1': '재료 상자 I', '재료상자2': '재료 상자 II', '재료상자3': '재료 상자 III',
                                        '재료상자4': '재료 상자 IV', '재료상자5': '재료 상자 V', '재료상자6': '재료 상자 VI',
                                        '골드꾸러미1': '골드 꾸러미1', '골드꾸러미2': '골드 꾸러미2', '골드꾸러미3': '골드 꾸러미3', '골드꾸러미4': '골드 꾸러미4',
                                        '다이아꾸러미1': '다이아 꾸러미1', '다이아꾸러미2': '다이아 꾸러미2', '다이아꾸러미3': '다이아 꾸러미3', '다이아꾸러미4': '다이아 꾸러미4',
                                    };
                                    const itemName = itemNameMap[itemId] || itemId;
                                    const itemTemplate = CONSUMABLE_ITEMS.find(item => item.name === itemName);
                                    return itemTemplate?.image || '/images/icon/item_box.png';
                                };

								const getItemDisplayName = (itemId: string): string => {
									const itemNameMap: Record<string, string> = {
										'장비상자1': '장비 상자 I', '장비상자2': '장비 상자 II', '장비상자3': '장비 상자 III',
										'장비상자4': '장비 상자 IV', '장비상자5': '장비 상자 V', '장비상자6': '장비 상자 VI',
										'재료상자1': '재료 상자 I', '재료상자2': '재료 상자 II', '재료상자3': '재료 상자 III',
										'재료상자4': '재료 상자 IV', '재료상자5': '재료 상자 V', '재료상자6': '재료 상자 VI',
										'골드꾸러미1': '골드 꾸러미1', '골드꾸러미2': '골드 꾸러미2', '골드꾸러미3': '골드 꾸러미3', '골드꾸러미4': '골드 꾸러미4',
										'다이아꾸러미1': '다이아 꾸러미1', '다이아꾸러미2': '다이아 꾸러미2', '다이아꾸러미3': '다이아 꾸러미3', '다이아꾸러미4': '다이아 꾸러미4',
									};
									return itemNameMap[itemId] || itemId;
								};
                                
                                const isCaptureMode = floor <= 20;
                                
                                return (
                                    <div
                                        key={floor}
                                        className={`rounded-lg p-2 border flex items-center justify-between gap-2 relative whitespace-nowrap ${
                                            isLocked
                                                ? 'bg-gray-900/50 border-gray-700/50 opacity-60'
                                                : isCurrent
                                                ? 'bg-gradient-to-r from-amber-700/50 to-yellow-700/50 border-amber-500/70 shadow-lg shadow-amber-600/50'
                                                : isCleared
                                                ? 'bg-gray-700/40 border-amber-600/50 hover:bg-gray-600/50 hover:border-amber-500/70'
                                                : 'bg-gray-800/30 border-amber-700/30 hover:bg-gray-700/40 hover:border-amber-600/50'
                                        }`}
                                    >
                                        {isLocked && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg z-10 backdrop-blur-sm">
                                                <div className="flex items-center gap-2 px-2">
                                                    <span className="text-2xl">🔒</span>
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-xs text-amber-300 font-semibold whitespace-nowrap">잠금</span>
                                                        <span className="text-[10px] text-amber-400/80 whitespace-nowrap">아래층을 먼저 클리어하세요</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-shrink-0 px-2 py-1 bg-amber-900/50 rounded border border-amber-600/40">
                                                <span className={`text-lg font-black ${
                                                    isCurrent ? 'text-yellow-300' : isCleared ? 'text-amber-200' : 'text-amber-400'
                                                }`}>
                                                    {floor}
                                                </span>
                                                <span className="text-xs text-amber-300 font-semibold">층</span>
                                                {isCleared && (
                                                    <span className="text-green-400 text-sm font-bold">✓</span>
                                                )}
                                            </div>
                                            
                                            {isCaptureMode && (
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/Black.png" alt="흑돌" className="w-5 h-5" />
                                                        <span className="text-xs text-amber-300 font-semibold">{stage.placements.black}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/White.png" alt="백돌" className="w-5 h-5" />
                                                        <span className="text-xs text-amber-300 font-semibold">{stage.placements.white}</span>
                                                    </div>
                                                    <div className="flex flex-col gap-0.5 flex-shrink-0">
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-xs text-amber-300 font-semibold">목표:</span>
                                                            <span className="text-xs text-yellow-300 font-bold">흑 {stage.targetScore?.black ?? 0}개</span>
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <span className="text-xs text-amber-300 font-semibold">제한:</span>
                                                            <span className="text-xs text-amber-200 font-bold">{stage.blackTurnLimit}턴</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {!isCaptureMode && (
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/Black.png" alt="흑돌" className="w-5 h-5" />
                                                        <span className="text-xs text-amber-300 font-semibold">{stage.placements.black}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/White.png" alt="백돌" className="w-5 h-5" />
                                                        <span className="text-xs text-amber-300 font-semibold">{stage.placements.white}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/BlackDouble.png" alt="흑 문양돌" className="w-5 h-5" />
                                                        <span className="text-xs text-amber-300 font-semibold">×{stage.placements.blackPattern}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/WhiteDouble.png" alt="백 문양돌" className="w-5 h-5" />
                                                        <span className="text-xs text-amber-300 font-semibold">×{stage.placements.whitePattern}</span>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            <div className="flex flex-col gap-1 flex-shrink-0 ml-auto">
                                                {isCleared ? (
                                                    <div className="flex items-center gap-1 flex-shrink-0">
                                                        <span className="text-xs text-amber-300 font-semibold">보상수령완료</span>
                                                    </div>
                                                ) : (
                                                    <>
                                                        {reward.gold > 0 ? (
                                                            <div className="flex items-center gap-0.5 flex-shrink-0">
                                                                <img src="/images/icon/Gold.png" alt="골드" title="골드" className="w-4 h-4" />
                                                                <span className="text-xs text-yellow-300 font-semibold">{reward.gold}</span>
                                                            </div>
                                                        ) : hasItemReward && reward.items && reward.items.length > 0 ? (
                                                            <div className="flex items-center gap-1 flex-shrink-0">
                                                                {reward.items.map((item: any, idx: number) => {
                                                                    const itemId = 'itemId' in item ? item.itemId : item.name || item.id;
                                                                    const itemImage = getItemImage(itemId);
                                                                    const itemDisplayName = getItemDisplayName(itemId);
                                                                    return (
                                                                        <div key={idx} className="flex items-center gap-0.5">
                                                                            <img src={itemImage} alt={itemDisplayName} title={itemDisplayName} className="w-4 h-4" />
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        ) : null}
                                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                                            <span className="text-xs text-green-300 font-semibold">전략EXP {reward.exp}</span>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        
										<button
											onClick={async () => {
                                                if (canChallenge && !isLocked) {
													try {
														// useApp.ts에서 라우팅을 처리하므로 여기서는 액션만 호출
														await handlers.handleAction({
                                                            type: 'START_TOWER_GAME',
                                                            payload: { floor }
                                                        });
													} catch (error) {
														console.error('[TowerLobby] Failed to start tower game:', error);
													}
                                                }
                                            }}
                                            disabled={!canChallenge || isLocked}
                                            className={`flex-shrink-0 px-3 py-2 rounded-lg font-semibold text-xs transition-all flex items-center justify-center gap-1.5 ${
                                                canChallenge && !isLocked
                                                    ? 'bg-gradient-to-br from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white shadow-lg shadow-amber-600/50'
                                                    : 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
                                            }`}
                                        >
                                            <span className="text-sm">⚡</span>
                                            <span className="text-[10px] leading-none">{effectiveActionPointCost}</span>
                                            <span className="text-[10px] leading-none">도전</span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            ) : (
                /* 데스크톱: 4개 패널 */
                <div className="flex-1 flex flex-col lg:flex-row lg:justify-center gap-2 sm:gap-3 lg:gap-4 px-2 sm:px-3 lg:px-4 py-2 sm:py-3 lg:py-4 min-h-0 overflow-hidden">
                    {/* 좌측: 랭킹 Top 100 */}
                    <div className="flex-1 lg:flex-[0_0_20%] lg:max-w-[20%] bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-2 sm:p-3 flex flex-col min-h-0 overflow-hidden backdrop-blur-md shadow-2xl shadow-amber-900/50">
                    <div className="flex items-center justify-between mb-2 flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <h2 className="text-base sm:text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300 drop-shadow-[0_0_4px_rgba(217,119,6,0.8)]">
                                랭킹 Top 100
                            </h2>
                            <span className="text-xs sm:text-sm font-semibold text-yellow-300">{timeUntilReset}</span>
                        </div>
                        <Button
                            onClick={() => setIsRewardModalOpen(true)}
                            colorScheme="none"
                            className="!p-1.5 !min-w-0 border border-amber-600/50 bg-amber-900/40 hover:bg-amber-800/60 backdrop-blur-sm text-xs sm:text-sm text-amber-200"
                        >
                            보상정보
                        </Button>
                    </div>
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {/* 내 랭킹 (맨 위 고정) */}
                        {myRankingEntry && (
                            <div className="bg-gradient-to-r from-amber-800/50 to-yellow-800/50 border-2 border-amber-500/70 shadow-lg shadow-amber-700/50 rounded-lg p-2 mb-2">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs sm:text-sm font-bold text-yellow-300 w-6 flex-shrink-0">
                                        {myRankingEntry.rank}
                                    </span>
                                    <Avatar
                                        userId={myRankingEntry.id}
                                        userName={myRankingEntry.nickname}
                                        avatarUrl={AVATAR_POOL.find(a => a.id === myRankingEntry.avatarId)?.url}
                                        borderUrl={BORDER_POOL.find(b => b.id === myRankingEntry.borderId)?.url}
                                        size={isMobile ? 24 : 32}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs sm:text-sm font-semibold truncate text-amber-100">{myRankingEntry.nickname}</p>
                                        <p className="text-[10px] sm:text-xs text-amber-200">
                                            층: {(myRankingEntry as any).towerFloor ?? 0}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* Top 100 */}
                        {top100Users.length > 0 ? (
                            top100Users.map((user, index) => {
                                const avatarUrl = AVATAR_POOL.find(a => a.id === user.avatarId)?.url;
                                const borderUrl = BORDER_POOL.find(b => b.id === user.borderId)?.url;
                                const isTop3 = index < 3;
                                const rank = index + 1;
                                return (
                                    <div
                                        key={user.id}
                                        className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                                            isTop3
                                                ? 'bg-gradient-to-r from-amber-900/40 to-yellow-900/40 border border-amber-500/50 hover:from-amber-800/50 hover:to-yellow-800/50'
                                                : 'bg-gray-800/40 border border-amber-700/30 hover:bg-gray-700/50 hover:border-amber-600/50'
                                        }`}
                                    >
                                        <span className={`text-xs sm:text-sm font-bold w-6 flex-shrink-0 ${
                                            rank === 1 ? 'text-yellow-300' : rank === 2 ? 'text-gray-300' : rank === 3 ? 'text-amber-500' : 'text-amber-300'
                                        }`}>
                                            {rank}
                                        </span>
                                        <Avatar
                                            userId={user.id}
                                            userName={user.nickname}
                                            avatarUrl={avatarUrl}
                                            borderUrl={borderUrl}
                                            size={isMobile ? 24 : 32}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs sm:text-sm font-semibold truncate text-amber-100">{user.nickname}</p>
                                            <p className="text-[10px] sm:text-xs text-amber-300/80">
                                                층: {(user as any).towerFloor ?? 0}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })
                        ) : (
                            <p className="text-center text-amber-300/60 py-8">랭킹 데이터가 없습니다.</p>
                        )}
                    </div>
                </div>

                    {/* 가운데: 도전의 탑 이미지 */}
                    <div className="flex-1 lg:flex-[0_0_25%] lg:max-w-[25%] bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl overflow-hidden backdrop-blur-md shadow-2xl shadow-amber-900/50 relative min-h-0">
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-600/10 via-transparent to-yellow-600/10 rounded-xl"></div>
                    <img
                        src={TOWER_CHALLENGE_LOBBY_IMG}
                        alt="도전의 탑"
                        className="w-full h-full object-cover object-center relative z-10"
                    />
                </div>

                    {/* 우측: 스테이지 */}
                    <div className="flex-1 lg:flex-[0_0_35%] lg:max-w-[35%] bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-2 sm:p-3 flex flex-col min-h-0 overflow-hidden backdrop-blur-md shadow-2xl shadow-amber-900/50">
                    <h2 className="text-base sm:text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300 mb-3 flex-shrink-0 drop-shadow-[0_0_4px_rgba(217,119,6,0.8)]">
                        스테이지
                    </h2>
                    <div
                        ref={stageScrollRef}
                        className="flex-1 overflow-y-auto space-y-1.5 pr-1"
                    >
                        {stages.map((floor) => {
                            const stage = TOWER_STAGES.find(s => s.id === `tower-${floor}`);
                            const userTowerFloor = (currentUserWithStatus as any).towerFloor ?? 0;
                            const isCleared = floor <= userTowerFloor;
                            const isCurrent = floor === userTowerFloor + 1;
                            const actionPoints = currentUserWithStatus?.actionPoints?.current ?? 0;
                            
                            // 관리자 여부 확인
                            const isAdmin = currentUser?.isAdmin ?? false;
                            
                            // 잠금 여부: 1층은 항상 열림, 2층 이상은 이전 층이 클리어되어야 함 (관리자는 예외)
                            const isLocked = !isAdmin && floor > 1 && floor > userTowerFloor + 1;
                            
                            // 클리어한 층은 행동력 소모가 0
                            const effectiveActionPointCost = isCleared ? 0 : (stage?.actionPointCost ?? 0);
                            const canChallenge = !isLocked && actionPoints >= effectiveActionPointCost;
                            
                            if (!stage) return null;
                            
                            // 목표 정보
                            const getTargetInfo = () => {
                                if (stage.blackTurnLimit) {
                                    return `흑 ${stage.targetScore?.black ?? 0}개 따내기 (${stage.blackTurnLimit}턴 제한)`;
                                } else if (stage.autoScoringTurns) {
                                    return `자동계가 (${stage.autoScoringTurns}턴)`;
                                }
                                return '승리';
                            };
                            
                            // 보상 정보
                            const reward = stage.rewards.firstClear;
                            const hasItemReward = reward.items && reward.items.length > 0;
                            
                            // 아이템 이미지 찾기 함수
                            const getItemImage = (itemId: string): string => {
                                // itemId를 이름으로 변환 (예: '장비상자1' -> '장비 상자 I')
                                const itemNameMap: Record<string, string> = {
                                    '장비상자1': '장비 상자 I',
                                    '장비상자2': '장비 상자 II',
                                    '장비상자3': '장비 상자 III',
                                    '장비상자4': '장비 상자 IV',
                                    '장비상자5': '장비 상자 V',
                                    '장비상자6': '장비 상자 VI',
                                    '재료상자1': '재료 상자 I',
                                    '재료상자2': '재료 상자 II',
                                    '재료상자3': '재료 상자 III',
                                    '재료상자4': '재료 상자 IV',
                                    '재료상자5': '재료 상자 V',
                                    '재료상자6': '재료 상자 VI',
                                    '골드꾸러미1': '골드 꾸러미1',
                                    '골드꾸러미2': '골드 꾸러미2',
                                    '골드꾸러미3': '골드 꾸러미3',
                                    '골드꾸러미4': '골드 꾸러미4',
                                    '다이아꾸러미1': '다이아 꾸러미1',
                                    '다이아꾸러미2': '다이아 꾸러미2',
                                    '다이아꾸러미3': '다이아 꾸러미3',
                                    '다이아꾸러미4': '다이아 꾸러미4',
                                };
                                
                                const itemName = itemNameMap[itemId] || itemId;
                                const itemTemplate = CONSUMABLE_ITEMS.find(item => item.name === itemName);
                                return itemTemplate?.image || '/images/icon/item_box.png';
                            };

							const getItemDisplayName = (itemId: string): string => {
								const itemNameMap: Record<string, string> = {
									'장비상자1': '장비 상자 I',
									'장비상자2': '장비 상자 II',
									'장비상자3': '장비 상자 III',
									'장비상자4': '장비 상자 IV',
									'장비상자5': '장비 상자 V',
									'장비상자6': '장비 상자 VI',
									'재료상자1': '재료 상자 I',
									'재료상자2': '재료 상자 II',
									'재료상자3': '재료 상자 III',
									'재료상자4': '재료 상자 IV',
									'재료상자5': '재료 상자 V',
									'재료상자6': '재료 상자 VI',
									'골드꾸러미1': '골드 꾸러미1',
									'골드꾸러미2': '골드 꾸러미2',
									'골드꾸러미3': '골드 꾸러미3',
									'골드꾸러미4': '골드 꾸러미4',
									'다이아꾸러미1': '다이아 꾸러미1',
									'다이아꾸러미2': '다이아 꾸러미2',
									'다이아꾸러미3': '다이아 꾸러미3',
									'다이아꾸러미4': '다이아 꾸러미4',
								};
								return itemNameMap[itemId] || itemId;
							};
                            
                            const isCaptureMode = floor <= 20; // 1-20층: 따내기 바둑
                            
                            return (
                                <div
                                    key={floor}
                                    className={`rounded-lg p-2.5 sm:p-3 border flex items-center justify-between gap-2 relative ${
                                        isLocked
                                            ? 'bg-gray-900/50 border-gray-700/50 opacity-60'
                                            : isCurrent
                                            ? 'bg-gradient-to-r from-amber-700/50 to-yellow-700/50 border-amber-500/70 shadow-lg shadow-amber-600/50'
                                            : isCleared
                                            ? 'bg-gray-700/40 border-amber-600/50 hover:bg-gray-600/50 hover:border-amber-500/70'
                                            : 'bg-gray-800/30 border-amber-700/30 hover:bg-gray-700/40 hover:border-amber-600/50'
                                    }`}
                                >
                                    {/* 자물쇠 오버레이 */}
                                    {isLocked && (
                                        <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 rounded-lg z-10 backdrop-blur-sm">
                                            <div className="flex items-center gap-2 px-2">
                                                <span className="text-2xl sm:text-3xl">🔒</span>
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-xs sm:text-sm text-amber-300 font-semibold whitespace-nowrap">잠금</span>
                                                    <span className="text-[10px] sm:text-xs text-amber-400/80 whitespace-nowrap">아래층을 먼저 클리어하세요</span>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {/* 왼쪽: 정보 영역 */}
                                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                        {/* 층수 */}
                                        <div className="flex items-center gap-1.5 flex-shrink-0 px-2.5 py-1.5 bg-amber-900/50 rounded border border-amber-600/40">
                                            <span className={`text-lg sm:text-xl font-black ${
                                                isCurrent ? 'text-yellow-300' : isCleared ? 'text-amber-200' : 'text-amber-400'
                                            }`}>
                                                {floor}
                                            </span>
                                            <span className="text-xs sm:text-sm text-amber-300 font-semibold">층</span>
                                            {isCleared && (
                                                <span className="text-green-400 text-sm sm:text-base font-bold">✓</span>
                                            )}
                                        </div>
                                        
                                        {/* 1-20층: 배치되는 돌 개수 + 목표점수와 제한턴 표시 */}
                                        {isCaptureMode && (
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* 배치되는 돌 개수 (한 줄) */}
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    {/* 흑돌 */}
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/Black.png" alt="흑돌" className="w-5 h-5 sm:w-6 sm:h-6" />
                                                        <span className="text-xs sm:text-sm text-amber-300 whitespace-nowrap font-semibold">{stage.placements.black}</span>
                                                    </div>
                                                    {/* 백돌 */}
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/White.png" alt="백돌" className="w-5 h-5 sm:w-6 sm:h-6" />
                                                        <span className="text-xs sm:text-sm text-amber-300 whitespace-nowrap font-semibold">{stage.placements.white}</span>
                                                    </div>
                                                </div>
                                                {/* 목표와 제한 (두 줄) */}
                                                <div className="flex flex-col gap-0.5 flex-shrink-0">
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs sm:text-sm text-amber-300 font-semibold whitespace-nowrap">목표:</span>
                                                        <span className="text-xs sm:text-sm text-yellow-300 font-bold whitespace-nowrap">흑 {stage.targetScore?.black ?? 0}개</span>
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs sm:text-sm text-amber-300 font-semibold whitespace-nowrap">제한:</span>
                                                        <span className="text-xs sm:text-sm text-amber-200 font-bold whitespace-nowrap">{stage.blackTurnLimit}턴</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* 21-100층: 일반돌과 문양돌 표시 */}
                                        {!isCaptureMode && (
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {/* 흑돌 */}
                                                <div className="flex items-center gap-1">
                                                    <img src="/images/single/Black.png" alt="흑돌" className="w-5 h-5 sm:w-6 sm:h-6" />
                                                    <span className="text-xs sm:text-sm text-amber-300 whitespace-nowrap font-semibold">{stage.placements.black}</span>
                                                </div>
                                                {/* 백돌 */}
                                                <div className="flex items-center gap-1">
                                                    <img src="/images/single/White.png" alt="백돌" className="w-5 h-5 sm:w-6 sm:h-6" />
                                                    <span className="text-xs sm:text-sm text-amber-300 whitespace-nowrap font-semibold">{stage.placements.white}</span>
                                                </div>
                                                    {/* 흑 문양돌 (항상 표시) */}
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/BlackDouble.png" alt="흑 문양돌" className="w-5 h-5 sm:w-6 sm:h-6" />
                                                        <span className="text-xs sm:text-sm text-amber-300 whitespace-nowrap font-semibold">×{stage.placements.blackPattern}</span>
                                                    </div>
                                                    {/* 백 문양돌 (항상 표시) */}
                                                    <div className="flex items-center gap-1">
                                                        <img src="/images/single/WhiteDouble.png" alt="백 문양돌" className="w-5 h-5 sm:w-6 sm:h-6" />
                                                        <span className="text-xs sm:text-sm text-amber-300 whitespace-nowrap font-semibold">×{stage.placements.whitePattern}</span>
                                                    </div>
                                            </div>
                                        )}
                                        
                                        {/* 보상 정보 (두 줄로 표시, 도전 버튼 왼쪽에 정렬) */}
                                        <div className="flex flex-col gap-1 flex-shrink-0 ml-auto">
                                            {isCleared ? (
                                                <div className="flex items-center gap-1 flex-shrink-0">
                                                    <span className="text-xs sm:text-sm text-amber-300 font-semibold whitespace-nowrap">보상수령완료</span>
                                                </div>
                                            ) : (
                                                <>
                                                    {/* 첫 번째 줄: 골드 또는 아이템 */}
                                                    {reward.gold > 0 ? (
                                                        <div className="flex items-center gap-0.5 flex-shrink-0">
                                                            <img src="/images/icon/Gold.png" alt="골드" title="골드" className="w-4 h-4 sm:w-5 sm:h-5" />
                                                            <span className="text-xs sm:text-sm text-yellow-300 font-semibold whitespace-nowrap">{reward.gold}</span>
                                                        </div>
                                                    ) : hasItemReward && reward.items ? (
                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                            {reward.items.map((item: any, idx: number) => {
                                                                const itemId = 'itemId' in item ? item.itemId : item.name || item.id;
                                                                const itemImage = getItemImage(itemId);
                                                                const itemDisplayName = getItemDisplayName(itemId);
                                                                return (
                                                                    <div key={idx} className="flex items-center gap-0.5">
                                                                        <img src={itemImage} alt={itemDisplayName} title={itemDisplayName} className="w-4 h-4 sm:w-5 sm:h-5" />
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    ) : null}
                                                    {/* 두 번째 줄: 전략EXP */}
                                                    <div className="flex items-center gap-0.5 flex-shrink-0">
                                                        <span className="text-xs sm:text-sm text-green-300 font-semibold whitespace-nowrap">전략EXP {reward.exp}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* 오른쪽: 도전 버튼 */}
									<button
										onClick={async () => {
                                            if (canChallenge && !isLocked) {
												try {
													const res = await handlers.handleAction({
                                                        type: 'START_TOWER_GAME',
                                                        payload: { floor }
                                                    });
													const gameId = (res as any)?.gameId || (res as any)?.clientResponse?.gameId;
													console.log('[TowerLobby] START_TOWER_GAME response:', { res, gameId });
													// useApp.ts에서 라우팅을 처리하므로 여기서는 액션만 호출
												} catch (error) {
													console.error('[TowerLobby] Failed to start tower game:', error);
												}
                                            }
                                        }}
                                        disabled={!canChallenge || isLocked}
                                        className={`flex-shrink-0 px-3 sm:px-4 py-2 rounded-lg font-semibold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 ${
                                            canChallenge && !isLocked
                                                ? 'bg-gradient-to-br from-amber-600 to-yellow-600 hover:from-amber-500 hover:to-yellow-500 text-white shadow-lg shadow-amber-600/50'
                                                : 'bg-gray-700/50 text-gray-400 cursor-not-allowed'
                                        }`}
                                    >
                                        <span className="text-sm sm:text-base">⚡</span>
                                        <span className="text-[10px] sm:text-xs leading-none">{effectiveActionPointCost}</span>
                                        <span className="text-[10px] sm:text-xs leading-none">도전</span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* 우측 끝: 퀵메뉴 + 아이템 */}
                <div className="flex-shrink-0 w-20 sm:w-24 lg:w-28 flex flex-col gap-2 sm:gap-3 lg:gap-4 min-h-0">
                    {/* 퀵메뉴 */}
                    <div className="flex-shrink-0 bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-1.5 sm:p-2 backdrop-blur-md shadow-2xl shadow-amber-900/50">
                        <QuickAccessSidebar compact={true} fillHeight={false} />
                    </div>

                    {/* 아이템 패널 */}
                    <div className="flex-1 bg-gradient-to-br from-gray-900/70 via-amber-950/60 to-gray-800/70 border-2 border-amber-600/40 rounded-xl p-1.5 sm:p-2 flex flex-col min-h-0 overflow-hidden backdrop-blur-md shadow-2xl shadow-amber-900/50">
                        <h3 className="text-xs sm:text-sm font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 to-yellow-300 mb-2 flex-shrink-0 text-center drop-shadow-[0_0_4px_rgba(217,119,6,0.8)]">
                            보유 아이템
                        </h3>
                        <div className="flex flex-col gap-1.5 justify-center items-center flex-1 min-h-0">
                            {(() => {
                                const inventory = currentUserWithStatus?.inventory || [];
                                
                                // 아이템 개수 계산 함수
                                const getItemCount = (itemName: string): number => {
                                    const item = inventory.find((inv: any) => inv.name === itemName || inv.id === itemName);
                                    return item?.quantity ?? 0;
                                };
                                
                                // 모든 아이템 항상 표시 (최대 보유 개수 포함)
                                const items = [
                                    {
                                        name: '턴 추가',
                                        icon: '/images/button/addturn.png',
                                        count: getItemCount('턴 추가') || getItemCount('addturn'),
                                        maxCount: 3
                                    },
                                    {
                                        name: '미사일',
                                        icon: '/images/button/missile.png',
                                        count: getItemCount('미사일') || getItemCount('missile'),
                                        maxCount: 2
                                    },
                                    {
                                        name: '히든',
                                        icon: '/images/button/hidden.png',
                                        count: getItemCount('히든') || getItemCount('hidden'),
                                        maxCount: 2
                                    },
                                    {
                                        name: '스캔',
                                        icon: '/images/button/scan.png',
                                        count: getItemCount('스캔') || getItemCount('scan'),
                                        maxCount: 2
                                    },
                                    {
                                        name: '배치변경',
                                        icon: '/images/button/reflesh.png',
                                        count: getItemCount('배치 새로고침') || getItemCount('배치변경') || getItemCount('reflesh') || getItemCount('refresh'),
                                        maxCount: 5
                                    }
                                ];
                                
                                return items.map((item, index) => (
                                    <button
                                        key={index}
                                        className="w-full bg-gray-800/40 border border-amber-700/30 rounded-lg p-1.5 hover:bg-gray-700/50 hover:border-amber-600/50 transition-colors flex flex-col items-center gap-0.5 flex-shrink-0"
                                        onClick={() => setIsItemShopOpen(true)}
                                    >
                                        <div className="relative w-8 h-8 flex-shrink-0">
                                            <img
                                                src={item.icon}
                                                alt={item.name}
                                                className="w-full h-full object-contain"
                                            />
                                            {/* 항상 개수 표시 (0개도 표시) */}
                                            <div className={`absolute -bottom-0.5 -right-0.5 text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center border border-amber-900 ${
                                                item.count > 0 ? 'bg-yellow-400 text-gray-900' : 'bg-gray-600 text-gray-300'
                                            }`}>
                                                {item.count}
                                            </div>
                                        </div>
                                        <p className="text-[10px] font-semibold text-amber-100 truncate w-full text-center leading-tight">{item.name}</p>
                                    </button>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
                </div>
            )}

            {/* 아이템 구매 모달 */}
            {isItemShopOpen && currentUserWithStatus && (
                <TowerItemShopModal
                    currentUser={currentUserWithStatus}
                    onClose={() => setIsItemShopOpen(false)}
                    onBuy={async (itemId, quantity) => {
                        await handlers.handleAction({
                            type: 'BUY_TOWER_ITEM',
                            payload: { itemId, quantity }
                        } as any);
                    }}
                />
            )}
        </div>
    );
};

export default TowerLobby;

