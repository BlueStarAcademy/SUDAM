import React, { useMemo } from 'react';
import Button from './Button.js';
import DraggableWindow from './DraggableWindow.js';

interface ConfirmModalProps {
    title?: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
    confirmText?: string;
    cancelText?: string;
    confirmColorScheme?: string;
    isTopmost?: boolean;
    windowId?: string;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ 
    title = '확인', 
    message, 
    onConfirm, 
    onCancel, 
    confirmText = '확인', 
    cancelText = '취소',
    confirmColorScheme = 'red',
    isTopmost = false,
    windowId
}) => {
    const modalWindowId = useMemo(() => windowId || 'confirm-modal', [windowId]);
    
    const handleConfirm = () => {
        onCancel();
        onConfirm();
    };

    return (
        <DraggableWindow
            title={title}
            windowId={modalWindowId}
            onClose={onCancel}
            initialWidth={400}
            modal={true}
            closeOnOutsideClick={true}
            isTopmost={isTopmost}
            zIndex={isTopmost ? 9999 : 50}
        >
            <div className="p-4">
                <p className="text-center text-gray-300 mb-6 whitespace-pre-line">{message}</p>
                <div className="flex gap-4">
                    <Button onClick={onCancel} colorScheme="gray" className="flex-1">
                        {cancelText}
                    </Button>
                    <Button onClick={handleConfirm} colorScheme={confirmColorScheme} className="flex-1">
                        {confirmText}
                    </Button>
                </div>
            </div>
        </DraggableWindow>
    );
};

export default ConfirmModal;

