
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ServerAction, AdminProps, GameMode, Announcement, OverrideAnnouncement } from '../../types.js';
import { SPECIAL_GAME_MODES, PLAYFUL_GAME_MODES } from '../../constants';
import Button from '../Button.js';

interface KataGoStatus {
    status: 'running' | 'starting' | 'stopped';
    processRunning: boolean;
    isStarting: boolean;
    pendingQueries: number;
    config: Record<string, string | number | boolean>;
    log: {
        path: string;
        size: number;
        lastModified: string;
        recentLines: string[];
        totalLines: number;
    } | null;
}

// FIX: The component uses various props which were not defined in the interface.
// The extended `AdminProps` type is likely incomplete. Defining the props directly fixes the type error.
interface ServerSettingsPanelProps {
    gameModeAvailability: Partial<Record<GameMode, boolean>>;
    announcements: Announcement[];
    globalOverrideAnnouncement: OverrideAnnouncement | null;
    announcementInterval: number;
    onAction: (action: ServerAction) => void;
    onBack: () => void;
}

const ServerSettingsPanel: React.FC<ServerSettingsPanelProps> = (props) => {
    const { gameModeAvailability, announcements, globalOverrideAnnouncement, announcementInterval, onAction, onBack } = props;
    const [newAnnouncement, setNewAnnouncement] = useState('');
    const [overrideMessage, setOverrideMessage] = useState(globalOverrideAnnouncement?.message || '');
    const [localAnnouncements, setLocalAnnouncements] = useState<Announcement[]>(announcements);
    const [localInterval, setLocalInterval] = useState(announcementInterval);
    const [kataGoStatus, setKataGoStatus] = useState<KataGoStatus | null>(null);
    const [kataGoLoading, setKataGoLoading] = useState(false);
    const [kataGoError, setKataGoError] = useState<string | null>(null);

    const dragItem = useRef<number | null>(null);
    const dragOverItem = useRef<number | null>(null);
    
    useEffect(() => { setLocalAnnouncements(announcements); }, [announcements]);
    useEffect(() => { setLocalInterval(announcementInterval); }, [announcementInterval]);
    useEffect(() => { setOverrideMessage(globalOverrideAnnouncement?.message || '')}, [globalOverrideAnnouncement]);
    
    const fetchKataGoStatus = async () => {
        setKataGoLoading(true);
        setKataGoError(null);
        try {
            const response = await fetch('/api/admin/katago-status');
            if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            const data = await response.json();
            setKataGoStatus(data);
        } catch (err: any) {
            setKataGoError(err.message);
            console.error('[ServerSettings] Failed to fetch KataGo status:', err);
        } finally {
            setKataGoLoading(false);
        }
    };
    
    useEffect(() => {
        fetchKataGoStatus();
    }, []);

    const handleDragSort = () => {
        if (dragItem.current === null || dragOverItem.current === null || dragItem.current === dragOverItem.current) {
            dragItem.current = null; dragOverItem.current = null; return;
        }
        const items = [...localAnnouncements];
        const draggedItemContent = items.splice(dragItem.current, 1)[0];
        items.splice(dragOverItem.current, 0, draggedItemContent);
        dragItem.current = null; dragOverItem.current = null;
        setLocalAnnouncements(items);
        onAction({ type: 'ADMIN_REORDER_ANNOUNCEMENTS', payload: { announcements: items } });
    };

    const handleAddAnnouncement = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newAnnouncement.trim()) return;
        onAction({ type: 'ADMIN_ADD_ANNOUNCEMENT', payload: { message: newAnnouncement } });
        setNewAnnouncement('');
    };
    
    const handleSetOverride = (e: React.FormEvent) => {
        e.preventDefault();
        if(!overrideMessage.trim()) return;
        onAction({ type: 'ADMIN_SET_OVERRIDE_ANNOUNCEMENT', payload: { message: overrideMessage } });
    }

    const allGameModes = useMemo(() => [...SPECIAL_GAME_MODES, ...PLAYFUL_GAME_MODES], []);

    return (
        <div className="space-y-8 bg-primary text-primary">
            <header className="flex justify-between items-center">
                <h1 className="text-3xl font-bold">서버 설정</h1>
                <button onClick={onBack} className="p-0 flex items-center justify-center w-10 h-10 rounded-full transition-all duration-100 active:shadow-inner active:scale-95 active:translate-y-0.5">
                    <img src="/images/button/back.png" alt="Back" className="w-10 h-10 sm:w-12 sm:h-12" />
                </button>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column */}
                <div className="space-y-8">
                    <div className="bg-panel border border-color text-on-panel p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold mb-4 border-b border-color pb-2">게임 모드 활성화</h2>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            {allGameModes.map(m => (
                                <label key={m.mode} className="flex items-center gap-2 p-2 bg-secondary/50 rounded-md">
                                    <input type="checkbox" checked={gameModeAvailability[m.mode] ?? m.available} onChange={e => onAction({ type: 'ADMIN_TOGGLE_GAME_MODE', payload: { mode: m.mode, isAvailable: e.target.checked } })} className="w-4 h-4" />
                                    <span>{m.mode}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Right Column */}
                <div className="space-y-8">
                     <div className="bg-panel border border-color text-on-panel p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold mb-4 border-b border-color pb-2">대기실 공지사항</h2>
                        <div className="space-y-3 mb-4 max-h-60 overflow-y-auto">
                            {localAnnouncements.map((ann, index) => (
                                <div key={ann.id} draggable onDragStart={() => dragItem.current = index} onDragEnter={() => dragOverItem.current = index} onDragEnd={handleDragSort} onDragOver={e => e.preventDefault()} className="flex items-center justify-between p-2 bg-secondary/50 rounded-md cursor-grab">
                                    <span className="text-sm">{ann.message}</span>
                                    <button onClick={() => onAction({ type: 'ADMIN_REMOVE_ANNOUNCEMENT', payload: { id: ann.id } })} className="text-red-500 hover:text-red-400 font-bold">X</button>
                                </div>
                            ))}
                        </div>
                        <form onSubmit={handleAddAnnouncement} className="flex gap-2">
                            <input type="text" value={newAnnouncement} onChange={e => setNewAnnouncement(e.target.value)} placeholder="새 공지사항..." className="flex-grow bg-secondary border border-color rounded-lg p-2 text-sm" />
                            <Button type="submit" colorScheme="green" className="!text-sm">추가</Button>
                        </form>
                        <div className="mt-4 flex items-center gap-2">
                            <label className="text-sm">간격(초):</label>
                            <input type="number" min="1" max="60" value={localInterval} onChange={e => setLocalInterval(parseInt(e.target.value, 10))} className="w-20 bg-secondary border border-color rounded-lg p-1 text-sm" />
                            <Button onClick={() => onAction({ type: 'ADMIN_SET_ANNOUNCEMENT_INTERVAL', payload: { interval: localInterval } })} className="!text-xs">적용</Button>
                        </div>
                    </div>
                    <div className="bg-panel border border-color text-on-panel p-6 rounded-lg shadow-lg">
                        <h2 className="text-xl font-semibold mb-4 border-b border-color pb-2">긴급 전체 공지</h2>
                        <form onSubmit={handleSetOverride} className="flex gap-2">
                            <input type="text" value={overrideMessage} onChange={e => setOverrideMessage(e.target.value)} placeholder="긴급 공지 메시지..." className="flex-grow bg-secondary border border-color rounded-lg p-2 text-sm" />
                            <Button type="submit" colorScheme="yellow" className="!text-sm">설정</Button>
                        </form>
                         {globalOverrideAnnouncement && <Button onClick={() => onAction({ type: 'ADMIN_CLEAR_OVERRIDE_ANNOUNCEMENT' })} colorScheme="red" className="mt-2 w-full !text-sm">긴급 공지 해제</Button>}
                    </div>
                    
                    <div className="bg-panel border border-color text-on-panel p-6 rounded-lg shadow-lg">
                        <div className="flex justify-between items-center mb-4 border-b border-color pb-2">
                            <h2 className="text-xl font-semibold">KataGo 상태</h2>
                            <Button onClick={fetchKataGoStatus} className="!text-xs" disabled={kataGoLoading}>
                                {kataGoLoading ? '로딩 중...' : '새로고침'}
                            </Button>
                        </div>
                        {kataGoError && (
                            <div className="mb-4 p-3 bg-red-900/50 border border-red-500 rounded text-red-200 text-sm">
                                오류: {kataGoError}
                            </div>
                        )}
                        {kataGoStatus && (
                            <div className="space-y-4 text-sm">
                                <div>
                                    <span className="font-semibold">상태: </span>
                                    <span className={kataGoStatus.status === 'running' ? 'text-green-400' : kataGoStatus.status === 'starting' ? 'text-yellow-400' : 'text-red-400'}>
                                        {kataGoStatus.status === 'running' ? '실행 중' : kataGoStatus.status === 'starting' ? '시작 중' : '중지됨'}
                                    </span>
                                    {kataGoStatus.pendingQueries > 0 && (
                                        <span className="ml-2 text-yellow-400">(대기 중인 분석: {kataGoStatus.pendingQueries})</span>
                                    )}
                                </div>
                                <div className="bg-secondary/30 p-3 rounded">
                                    <div className="font-semibold mb-2">설정:</div>
                                    <div className="space-y-1 text-xs font-mono">
                                        <div>USE_HTTP_API: {kataGoStatus.config.USE_HTTP_API ? 'true' : 'false'}</div>
                                        {kataGoStatus.config.USE_HTTP_API && (
                                            <div>KATAGO_API_URL: {kataGoStatus.config.KATAGO_API_URL}</div>
                                        )}
                                        {!kataGoStatus.config.USE_HTTP_API && (
                                            <>
                                                <div>KATAGO_PATH: {kataGoStatus.config.KATAGO_PATH}</div>
                                                <div>KATAGO_MODEL_PATH: {kataGoStatus.config.KATAGO_MODEL_PATH}</div>
                                                <div>KATAGO_MAX_VISITS: {kataGoStatus.config.KATAGO_MAX_VISITS}</div>
                                                <div>KATAGO_NUM_ANALYSIS_THREADS: {kataGoStatus.config.KATAGO_NUM_ANALYSIS_THREADS}</div>
                                            </>
                                        )}
                                    </div>
                                </div>
                                {kataGoStatus.log && (
                                    <div className="bg-secondary/30 p-3 rounded">
                                        <div className="font-semibold mb-2">로그 파일:</div>
                                        <div className="text-xs space-y-1">
                                            <div>경로: {kataGoStatus.log.path}</div>
                                            <div>크기: {(kataGoStatus.log.size / 1024).toFixed(2)} KB</div>
                                            <div>마지막 수정: {new Date(kataGoStatus.log.lastModified).toLocaleString()}</div>
                                            <div>전체 라인 수: {kataGoStatus.log.totalLines}</div>
                                            {kataGoStatus.log.recentLines.length > 0 && (
                                                <div className="mt-2 max-h-40 overflow-y-auto bg-black/50 p-2 rounded font-mono text-xs">
                                                    <div className="font-semibold mb-1">최근 로그 ({kataGoStatus.log.recentLines.length}줄):</div>
                                                    {kataGoStatus.log.recentLines.slice(-20).map((line, idx) => (
                                                        <div key={idx} className="text-gray-300">{line}</div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ServerSettingsPanel;
