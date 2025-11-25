
import React from 'react';
// FIX: Corrected import path for types. The path was './../types.js' which pointed to 'components/types.js', but the file is in the root directory.
import { GameProps, GameStatus, Negotiation } from '../../types.js';
import GameSummaryModal from '../GameSummaryModal.js';
import NigiriModal from '../NigiriModal.js';
import CaptureBidModal from '../CaptureBidModal.js';
import CaptureTiebreakerModal from '../CaptureTiebreakerModal.js';
import RPSMinigame from '../RPSMinigame.js';
import ThiefRoleSelection from '../ThiefRoleSelection.js';
import ThiefRoleConfirmedModal from '../ThiefRoleConfirmedModal.js';
import TurnPreferenceSelection from '../TurnPreferenceSelection.js';
import NoContestModal from '../NoContestModal.js';
import ThiefRoundSummary from '../ThiefRoundSummary.js';
import CurlingRoundSummary from '../CurlingRoundSummary.js';
import Button from '../Button.js';
import DiceRoundSummary from '../DiceRoundSummary.js';
import BasePlacementModal from '../BasePlacementModal.js';
import KomiBiddingPanel from '../KomiBiddingPanel.js';
import AlkkagiPlacementModal from '../AlkkagiPlacementModal.js';
import NegotiationModal from '../NegotiationModal.js';
import DiceGoTurnSelectionModal from '../DiceGoTurnSelectionModal.js';
import BaseStartConfirmationModal from '../BaseStartConfirmationModal.js';
import AlkkagiRoundSummary from '../AlkkagiRoundSummary.js';
import DiceGoStartConfirmationModal from '../DiceGoStartConfirmationModal.js';
import CurlingStartConfirmationModal from '../CurlingStartConfirmationModal.js';
import AlkkagiStartConfirmationModal from '../AlkkagiStartConfirmationModal.js';
import SinglePlayerSummaryModal from '../SinglePlayerSummaryModal.js';
import TowerSummaryModal from '../TowerSummaryModal.js';

interface GameModalsProps extends GameProps {
    confirmModalType: 'resign' | null;
    onHideConfirmModal: () => void;
    showResultModal: boolean;
    onCloseResults: () => void;
}

const GameModals: React.FC<GameModalsProps> = (props) => {
    const { session, currentUser, onAction, confirmModalType, onHideConfirmModal, showResultModal, onCloseResults, isSpectator, activeNegotiation, onlineUsers, onViewUser } = props;
    const { gameStatus, mode, id: gameId } = session;

    const renderModals = () => {
        if (activeNegotiation) {
            return <NegotiationModal negotiation={activeNegotiation} currentUser={currentUser} onAction={onAction} onlineUsers={onlineUsers} />;
        }

        // 싱글플레이: showResultModal이 true이거나 ended 상태일 때만 SinglePlayerSummaryModal 표시
        // scoring 상태일 때는 분석 결과가 준비될 때까지 게임 화면을 유지 (바둑판 초기화 방지)
        if (session.isSinglePlayer && (showResultModal || gameStatus === 'ended')) {
            return <SinglePlayerSummaryModal session={session} currentUser={currentUser} onAction={onAction} onClose={onCloseResults} />;
        }

        // 도전의 탑: showResultModal이 true이거나 ended 상태일 때만 TowerSummaryModal 표시
        // scoring 상태일 때는 분석 결과가 준비될 때까지 게임 화면을 유지 (바둑판 초기화 방지)
        // 확인 버튼을 눌렀을 때 모달이 닫히도록 하기 위해 showResultModal이 명시적으로 false일 때는 모달을 표시하지 않음
        if (session.gameCategory === 'tower' && showResultModal !== false && (showResultModal || gameStatus === 'ended')) {
            return <TowerSummaryModal session={session} currentUser={currentUser} onAction={onAction} onClose={onCloseResults} />;
        }
        
        const playerOnlyStates: GameStatus[] = [
            'nigiri_choosing', 'nigiri_guessing',
            'base_placement',
            'komi_bidding',
            'capture_bidding',
            'dice_rps', 'thief_rps', 'alkkagi_rps', 'curling_rps', 'omok_rps', 'ttamok_rps',
            'turn_preference_selection',
            'thief_role_selection',
            'alkkagi_simultaneous_placement',
            'dice_turn_rolling',
            
        ];

        if (isSpectator && playerOnlyStates.includes(gameStatus)) {
            return null;
        }
        
        const rpsStates: GameStatus[] = ['dice_rps', 'dice_rps_reveal', 'thief_rps', 'thief_rps_reveal', 'alkkagi_rps', 'alkkagi_rps_reveal', 'curling_rps', 'curling_rps_reveal', 'omok_rps', 'omok_rps_reveal', 'ttamok_rps', 'ttamok_rps_reveal'];
        
        if (gameStatus === 'dice_turn_rolling' || gameStatus === 'dice_turn_rolling_animating' || gameStatus === 'dice_turn_choice') return <DiceGoTurnSelectionModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'dice_start_confirmation') return <DiceGoStartConfirmationModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'turn_preference_selection') return <TurnPreferenceSelection session={session} currentUser={currentUser} onAction={onAction} tiebreaker={session.turnSelectionTiebreaker} />;
        if (['nigiri_choosing', 'nigiri_guessing', 'nigiri_reveal'].includes(gameStatus)) return <NigiriModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'capture_bidding') return <CaptureBidModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (['capture_tiebreaker', 'capture_reveal'].includes(gameStatus)) return <CaptureTiebreakerModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'base_placement') return <BasePlacementModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (['komi_bidding', 'komi_bid_reveal'].includes(gameStatus)) return <KomiBiddingPanel session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'base_game_start_confirmation') return <BaseStartConfirmationModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (rpsStates.includes(gameStatus)) return <RPSMinigame session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'alkkagi_start_confirmation') return <AlkkagiStartConfirmationModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'curling_start_confirmation') return <CurlingStartConfirmationModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'thief_role_selection') return <ThiefRoleSelection session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'thief_role_confirmed') return <ThiefRoleConfirmedModal session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'thief_round_end') return <ThiefRoundSummary session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'curling_round_end') return <CurlingRoundSummary session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'alkkagi_round_end') return <AlkkagiRoundSummary session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'dice_round_end') return <DiceRoundSummary session={session} currentUser={currentUser} onAction={onAction} />;
        if (gameStatus === 'alkkagi_simultaneous_placement') return <AlkkagiPlacementModal session={session} currentUser={currentUser} />;
        
        // 게임이 종료되었을 때만 결과 모달 표시
        // scoring 상태일 때는 분석 결과가 준비될 때까지 게임 화면을 유지 (바둑판 초기화 방지)
        // 도전의 탑과 싱글플레이어는 이미 위에서 처리했으므로 제외
        if ((showResultModal || gameStatus === 'ended' || gameStatus === 'no_contest') && 
            !session.isSinglePlayer && session.gameCategory !== 'tower') {
            if (gameStatus === 'ended') return <GameSummaryModal session={session} currentUser={currentUser} onConfirm={onCloseResults} onAction={onAction} />;
            if (gameStatus === 'no_contest') return <NoContestModal session={session} currentUser={currentUser} onConfirm={onCloseResults} />;
        }
        return null;
    };

    const confirmModalContent = {
        resign: {
            title: "기권 확인",
            message: "정말로 기권하시겠습니까? 기권패로 처리됩니다.",
            confirmText: "기권",
            onConfirm: () => onAction({ type: 'RESIGN_GAME', payload: { gameId } }),
        },
    };

    const content = confirmModalType ? confirmModalContent[confirmModalType] : null;

    return (
        <>
            {renderModals()}
            {content && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
                    <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-6 border border-gray-700">
                        <h2 className="text-xl font-bold text-center mb-4">{content.title}</h2>
                        <p className="text-center text-gray-300 mb-6">{content.message}</p>
                        <div className="flex gap-4 mt-4">
                            <Button onClick={onHideConfirmModal} colorScheme="gray" className="w-full">취소</Button>
                            <Button onClick={() => { onHideConfirmModal(); content.onConfirm(); }} colorScheme="red" className="w-full">{content.confirmText}</Button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default GameModals;
