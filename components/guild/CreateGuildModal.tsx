
import React, { useState } from 'react';
import { useAppContext } from '../../hooks/useAppContext.js';
import DraggableWindow from '../DraggableWindow.js';
import Button from '../Button.js';
import { containsProfanity } from '../../profanity.js';
import { GUILD_CREATION_COST } from '../../constants/index.js';
import ToggleSwitch from '../ui/ToggleSwitch.js';

interface CreateGuildModalProps {
    onClose: () => void;
}

const CreateGuildModal: React.FC<CreateGuildModalProps> = ({ onClose }) => {
    const { handlers, currentUserWithStatus } = useAppContext();
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [isPublic, setIsPublic] = useState(true);
    const [errors, setErrors] = useState<{ name?: string; description?: string }>({});

    // 다이아몬드 타입 변환 (BigInt일 수 있음)
    const userDiamonds = currentUserWithStatus 
        ? (typeof currentUserWithStatus.diamonds === 'bigint' 
            ? Number(currentUserWithStatus.diamonds) 
            : (typeof currentUserWithStatus.diamonds === 'number' 
                ? currentUserWithStatus.diamonds 
                : (parseInt(String(currentUserWithStatus.diamonds || 0), 10) || 0)))
        : 0;
    const canAfford = userDiamonds >= GUILD_CREATION_COST;

    const validateName = (value: string) => {
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            setErrors(prev => ({ ...prev, name: undefined }));
            return;
        }
        if (trimmed.length < 2 || trimmed.length > 6) {
            setErrors(prev => ({ ...prev, name: '길드 이름은 2~6자 사이여야 합니다.' }));
            return;
        }
        if (containsProfanity(trimmed)) {
            setErrors(prev => ({ ...prev, name: '부적절한 단어가 포함되어 있습니다.' }));
            return;
        }
        setErrors(prev => ({ ...prev, name: undefined }));
    };

    const validateDescription = (value: string) => {
        if (value.length > 200) {
            setErrors(prev => ({ ...prev, description: '길드 설명은 200자 이하여야 합니다.' }));
            return;
        }
        if (containsProfanity(value)) {
            setErrors(prev => ({ ...prev, description: '부적절한 단어가 포함되어 있습니다.' }));
            return;
        }
        setErrors(prev => ({ ...prev, description: undefined }));
    };

    const handleCreate = () => {
        const trimmedName = name.trim();
        const trimmedDescription = description.trim();

        // 유효성 검사
        if (trimmedName.length < 2 || trimmedName.length > 6) {
            setErrors({ name: '길드 이름은 2~6자 사이여야 합니다.' });
            return;
        }
        if (containsProfanity(trimmedName)) {
            setErrors({ name: '부적절한 단어가 포함되어 있습니다.' });
            return;
        }
        if (trimmedDescription && trimmedDescription.length > 200) {
            setErrors({ description: '길드 설명은 200자 이하여야 합니다.' });
            return;
        }
        if (trimmedDescription && containsProfanity(trimmedDescription)) {
            setErrors({ description: '부적절한 단어가 포함되어 있습니다.' });
            return;
        }
        if (!canAfford) {
            alert(`다이아가 부족합니다. (필요: ${GUILD_CREATION_COST}개, 보유: ${userDiamonds}개)`);
            return;
        }

        if (window.confirm(`다이아 ${GUILD_CREATION_COST}개를 사용하여 길드를 창설하시겠습니까?`)) {
            handlers.handleAction({ type: 'CREATE_GUILD', payload: { name: trimmedName, description: trimmedDescription, isPublic } });
            onClose();
        }
    };

    return (
        <DraggableWindow 
            title="길드 창설" 
            onClose={onClose} 
            windowId="create-guild"
            variant="store"
            initialWidth={500}
            initialHeight={580}
        >
            <div className="flex flex-col h-full space-y-5">
                {/* 헤더 섹션 */}
                <div className="flex items-center gap-3 pb-3 border-b border-cyan-300/20">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/30 to-blue-500/30 flex items-center justify-center border border-cyan-300/40">
                        <span className="text-2xl">🏰</span>
                    </div>
                    <div className="flex-1">
                        <h2 className="text-xl font-bold bg-gradient-to-r from-cyan-200 to-purple-200 bg-clip-text text-transparent">
                            새로운 길드 창설
                        </h2>
                        <p className="text-xs text-cyan-300/70 mt-0.5">동료들과 함께 목표를 향해 나아가세요</p>
                    </div>
                </div>

                {/* 길드 이름 입력 */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-cyan-200 flex items-center gap-2">
                        <span className="text-cyan-400">✦</span>
                        길드 이름
                        <span className="text-xs text-cyan-300/60 font-normal">(필수, 2-6자)</span>
                    </label>
                    <input 
                        type="text" 
                        placeholder="예: 명월길드" 
                        value={name} 
                        onChange={(e) => {
                            setName(e.target.value);
                            validateName(e.target.value);
                        }}
                        className={`w-full bg-gradient-to-br from-[#1a2342]/80 to-[#0f1529]/80 px-4 py-3 rounded-lg border-2 transition-all duration-200 ${
                            errors.name 
                                ? 'border-rose-500/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/30' 
                                : 'border-cyan-300/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30'
                        } text-cyan-100 placeholder:text-cyan-500/50 focus:outline-none`}
                        maxLength={6}
                    />
                    {errors.name && (
                        <p className="text-xs text-rose-400 flex items-center gap-1">
                            <span>⚠</span>
                            {errors.name}
                        </p>
                    )}
                    {name.trim().length > 0 && !errors.name && (
                        <p className="text-xs text-green-400 flex items-center gap-1">
                            <span>✓</span>
                            사용 가능한 이름입니다
                        </p>
                    )}
                </div>

                {/* 길드 설명 입력 */}
                <div className="space-y-2">
                    <label className="block text-sm font-semibold text-cyan-200 flex items-center gap-2">
                        <span className="text-cyan-400">📝</span>
                        길드 소개
                        <span className="text-xs text-cyan-300/60 font-normal">(선택, 최대 200자)</span>
                    </label>
                    <textarea 
                        placeholder="길드의 목표나 특징을 소개해주세요..." 
                        value={description} 
                        onChange={(e) => {
                            setDescription(e.target.value);
                            validateDescription(e.target.value);
                        }}
                        className={`w-full bg-gradient-to-br from-[#1a2342]/80 to-[#0f1529]/80 px-4 py-3 rounded-lg border-2 transition-all duration-200 ${
                            errors.description 
                                ? 'border-rose-500/60 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/30' 
                                : 'border-cyan-300/30 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-500/30'
                        } text-cyan-100 placeholder:text-cyan-500/50 focus:outline-none resize-none`}
                        maxLength={200}
                        rows={4}
                    />
                    <div className="flex items-center justify-between">
                        {errors.description ? (
                            <p className="text-xs text-rose-400 flex items-center gap-1">
                                <span>⚠</span>
                                {errors.description}
                            </p>
                        ) : (
                            <div></div>
                        )}
                        <p className="text-xs text-cyan-300/60">
                            {description.length}/200
                        </p>
                    </div>
                </div>

                {/* 공개 설정 */}
                <div className="bg-gradient-to-r from-[#1a2342]/60 to-[#0f1529]/60 rounded-lg p-4 border border-cyan-300/20">
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-semibold text-cyan-200 flex items-center gap-2">
                            <span className="text-cyan-400">🔓</span>
                            공개 설정
                        </label>
                        <ToggleSwitch checked={isPublic} onChange={setIsPublic} />
                    </div>
                    <p className="text-xs text-cyan-300/70 leading-relaxed">
                        {isPublic ? (
                            <span className="flex items-center gap-1">
                                <span className="text-green-400">●</span>
                                <span>누구나 자유롭게 가입할 수 있는 공개 길드입니다.</span>
                            </span>
                        ) : (
                            <span className="flex items-center gap-1">
                                <span className="text-yellow-400">●</span>
                                <span>길드장의 승인 후 가입할 수 있는 비공개 길드입니다.</span>
                            </span>
                        )}
                    </p>
                </div>

                {/* 비용 정보 */}
                <div className="bg-gradient-to-r from-amber-900/30 via-yellow-900/30 to-amber-900/30 rounded-lg p-4 border-2 border-amber-500/40 relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/10 to-transparent animate-pulse"></div>
                    <div className="relative flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 flex items-center justify-center shadow-lg shadow-amber-500/50">
                                <span className="text-xl">💎</span>
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-amber-200">창설 비용</p>
                                <p className="text-xs text-amber-300/70">길드를 만들기 위한 필수 비용</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-2xl font-bold text-amber-300 flex items-center gap-1">
                                <span>{GUILD_CREATION_COST.toLocaleString()}</span>
                                <span className="text-lg">💎</span>
                            </p>
                            {!canAfford && (
                                <p className="text-xs text-rose-400 mt-1">
                                    부족: {Math.max(0, GUILD_CREATION_COST - userDiamonds)}개
                                </p>
                            )}
                        </div>
                    </div>
                    {canAfford && (
                        <div className="relative mt-3 pt-3 border-t border-amber-500/30">
                            <div className="flex items-center gap-2 text-xs text-amber-200/80">
                                <span className="text-green-400">✓</span>
                                <span>보유 다이아: {userDiamonds.toLocaleString()}개</span>
                                <span className="text-amber-300/60">→</span>
                                <span>잔여: {(userDiamonds - GUILD_CREATION_COST).toLocaleString()}개</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* 하단 버튼 */}
                <div className="flex gap-3 pt-2 border-t border-cyan-300/20 mt-auto">
                    <Button 
                        onClick={onClose} 
                        colorScheme="gray"
                        className="flex-1 py-2.5 font-semibold"
                    >
                        취소
                    </Button>
                    <Button 
                        onClick={handleCreate} 
                        colorScheme={canAfford ? "green" : "gray"}
                        disabled={!canAfford || name.trim().length < 2 || !!errors.name || !!errors.description}
                        className="flex-1 py-2.5 font-semibold bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/30"
                    >
                        {canAfford ? '길드 창설' : '다이아 부족'}
                    </Button>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default CreateGuildModal;