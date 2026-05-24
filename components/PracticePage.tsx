import React, { useContext, useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react';
import { AppContext } from '../context/AppContext';
import useTypingGame from '../hooks/useTypingGame';
import { CodeEditor, CodeEditorHandle } from './CodeEditor';
import StatsDisplay from './StatsDisplay';
import { Card } from './ui/Card';
import Keyboard from './Keyboard';
import { Button } from './ui/Button';
import { ResultsModal } from './ResultsModal';
import { TargetedResultsModal } from './TargetedResultsModal';
import { FrustrationModal } from './FrustrationModal';
import { MobileActionMenu } from './ui/MobileActionMenu';

import { ResetIcon } from './icons/ResetIcon';
import { PlayIcon } from './icons/PlayIcon';
import { PauseIcon } from './icons/PauseIcon';
import { HandGuideIcon } from './icons/HandGuideIcon';
import { Dropdown, DropdownItem, DropdownRef } from './ui/Dropdown';
import { BlockIcon } from './icons/BlockIcon';
import { PausedSessionData, FinishedSessionData, SnippetLength, SnippetLevel, ContentType, PracticeMode } from '../types';
import { FileCodeIcon } from './icons/FileCodeIcon';
import { XIcon } from './icons/XIcon';
import { WarningIcon } from './icons/WarningIcon';
import { CopyIcon } from './icons/CopyIcon';
import { CheckIcon } from './icons/CheckIcon';

// More icon for mobile menu
const MoreIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
    </svg>
);

const blockOnErrorOptions = [
    { label: 'Off', value: 0 },
    { label: 'After 1 Error', value: 1 },
    { label: 'After 2 Errors', value: 2 },
    { label: 'After 3 Errors', value: 3 },
];

const PracticeQueueSidebar: React.FC = () => {
    const context = useContext(AppContext);
    if (!context) return null;
    const { practiceQueue, currentQueueIndex } = context;

    return (
        <div className="flex flex-col gap-2 h-full">
            <h3 className="font-semibold text-slate-700 dark:text-slate-300 px-2">Queue</h3>
            <div className="flex-1 overflow-y-auto space-y-2 px-2 custom-scrollbar">
                {practiceQueue.map((snippet, index) => (
                    <div key={index} className={`p-2 rounded text-xs border ${index === currentQueueIndex ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-200 dark:border-blue-700' : 'bg-slate-50 dark:bg-slate-800 border-transparent'}`}>
                        <div className={`font-medium mb-1 ${index === currentQueueIndex ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`}>
                            Snippet {index + 1}
                        </div>
                        <div className="font-mono text-slate-600 dark:text-slate-400 truncate opacity-75">
                            {snippet.substring(0, 40).replace(/\n/g, ' ')}...
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const PracticePage: React.FC = () => {
    const context = useContext(AppContext);
    if (!context) return null;

    const {
        snippet, isLoadingSnippet, snippetError, selectedLanguage, fetchNewSnippet,
        showKeyboard, showHandGuide, toggleHandGuide, addPracticeResult,
        startCustomSession, navigateTo, isCustomSession, currentTargetedKeys,
        setCurrentTargetedKeys, setLastPracticeAction, lastPracticeAction, startTargetedSession,
        blockOnErrorThreshold, setBlockOnErrorThreshold,
        setRequestFocusOnCodeCallback, requestFocusOnCode,
        practiceQueue, currentQueueIndex, loadNextSnippetInQueue,
        isSetupModalOpen, openSetupModal, closeSetupModal, isInitialSetupComplete,
        restorePracticeSession,
        sessionResetKey,
        practiceMode, // Added practiceMode
    } = context;

    const currentSessionId = useRef<string>(Date.now().toString());

    const [isResultsModalOpen, setIsResultsModalOpen] = useState(false);
    const [isTargetedResultsModalOpen, setIsTargetedResultsModalOpen] = useState(false);
    const [lastStats, setLastStats] = useState({ wpm: 0, accuracy: 0, errors: 0, duration: 0, errorMap: {}, attemptMap: {} });
    const [isCapsLockOn, setIsCapsLockOn] = useState(false);
    const [hasSubmitted, setHasSubmitted] = useState(false);
    const [isSessionEndedEarly, setIsSessionEndedEarly] = useState(false);
    const [saveStatus, setSaveStatus] = useState<{ saved: boolean; reason?: string } | null>(null);
    const [sessionToRestore, setSessionToRestore] = useState<PausedSessionData | null>(null);
    const [isCopied, setIsCopied] = useState(false);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

    const handleCopy = async () => {
        const copyToClipboardFallback = (text: string) => {
            try {
                const textArea = document.createElement("textarea");
                textArea.value = text;
                textArea.style.position = "fixed";
                textArea.style.left = "-9999px";
                textArea.style.top = "0";
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();
                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);
                if (successful) {
                    setIsCopied(true);
                    setTimeout(() => setIsCopied(false), 2000);
                    context?.showAlert('Code copied to clipboard!', 'info');
                } else {
                    throw new Error('Fallback copy failed');
                }
            } catch (err) {
                console.error('Fallback copy failed: ', err);
                context?.showAlert('Failed to copy code.', 'error');
            }
        };

        if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(snippet);
                setIsCopied(true);
                setTimeout(() => setIsCopied(false), 2000);
                context?.showAlert('Code copied to clipboard!', 'info');
            } catch (err) {
                console.warn('Clipboard API failed, trying fallback...', err);
                copyToClipboardFallback(snippet);
            }
        } else {
            copyToClipboardFallback(snippet);
        }
    };

    const gameContainerRef = useRef<HTMLDivElement>(null);
    const blockOnErrorRef = useRef<DropdownRef>(null);
    const codeEditorRef = useRef<CodeEditorHandle>(null);
    const hasRestoredOnMount = useRef(false);

    const onPauseCallback = useCallback(() => requestFocusOnCode(), [requestFocusOnCode]);
    const onResumeCallback = useCallback(() => requestFocusOnCode(), [requestFocusOnCode]);

    const game = useTypingGame(snippet, blockOnErrorThreshold, {
        onPause: onPauseCallback,
        onResume: onResumeCallback
    });

    // ---------------------------------------------------------
    // ✅ GLOBAL TYPING HANDLER
    // ---------------------------------------------------------
    const gameRef = useRef(game);
    useLayoutEffect(() => {
        gameRef.current = game;
    }, [game]);
    // ---------------------------------------------------------

    const nextChar = snippet[game.currentIndex] || '';

    // Force game reset when sessionResetKey changes
    useEffect(() => {
        gameRef.current.reset();
        currentSessionId.current = Date.now().toString();
        requestFocusOnCode();
    }, [sessionResetKey, requestFocusOnCode]);

    const resetGame = useCallback(() => {
        gameRef.current.reset();
        currentSessionId.current = Date.now().toString();
        requestFocusOnCode();
    }, [requestFocusOnCode]);

    const togglePause = useCallback(() => {
        gameRef.current.togglePause();
        requestFocusOnCode();
    }, [requestFocusOnCode]);

    const handleSetupNew = useCallback(() => {
        setIsResultsModalOpen(false);
        setIsTargetedResultsModalOpen(false);
        openSetupModal();
    }, [openSetupModal, setIsResultsModalOpen, setIsTargetedResultsModalOpen]);

    const handleEndSession = useCallback(() => {
        console.log("handleEndSession triggered");
        try {
            setIsSessionEndedEarly(true);
            // We need to calculate stats up to this point
            const currentStats = {
                wpm: gameRef.current.wpm,
                accuracy: gameRef.current.accuracy,
                errors: gameRef.current.errors,
                duration: gameRef.current.duration,
                errorMap: gameRef.current.errorMap,
                attemptMap: gameRef.current.attemptMap
            };
            setLastStats(currentStats);

            // Smart Save Logic
            const charsTyped = gameRef.current.currentIndex;
            const totalChars = snippet.length;
            const completionPercentage = totalChars > 0 ? (charsTyped / totalChars) * 100 : 0;
            const duration = gameRef.current.duration;

            // Criteria: (Characters >= 20) AND ((Completion = 100%) OR ((Completion >= 70% OR Characters >= 150) AND Duration >= 10s))
            const hasMinChars = charsTyped >= 20;
            const isComplete = completionPercentage >= 100;
            const hasGoodProgress = (completionPercentage >= 70 || charsTyped >= 150) && duration >= 10;

            if (hasMinChars && (isComplete || hasGoodProgress)) {
                addPracticeResult({
                    id: currentSessionId.current,
                    date: Date.now(),
                    wpm: currentStats.wpm,
                    accuracy: currentStats.accuracy,
                    duration: currentStats.duration,
                    errors: currentStats.errors,
                    language: selectedLanguage.name,
                    snippetLength: snippet.length,
                    timestamp: Date.now(),
                    linesTyped: gameRef.current.typedText.split('\n').length,
                    errorMap: currentStats.errorMap,
                    attemptMap: currentStats.attemptMap
                });
                setSaveStatus({ saved: true });
            } else {
                let reason = "Session not saved.";
                if (!hasMinChars) {
                    reason = "Not saved: Less than 20 characters typed.";
                } else if (!hasGoodProgress) {
                    reason = "Not saved: Duration under 10s or progress too low (<70% or <150 chars).";
                }
                setSaveStatus({ saved: false, reason });
            }
        } catch (error) {
            console.error("Error in handleEndSession:", error);
            setSaveStatus({ saved: false, reason: "Error saving session: " + (error instanceof Error ? error.message : String(error)) });
        } finally {
            setIsResultsModalOpen(true);
        }
    }, [addPracticeResult, selectedLanguage.name, snippet]);

    const handlePracticeSame = useCallback(() => {
        setIsResultsModalOpen(false);
        setIsTargetedResultsModalOpen(false);
        resetGame();
        requestFocusOnCode();
    }, [resetGame, requestFocusOnCode]);

    const handleNextSnippet = useCallback(() => {
        setIsResultsModalOpen(false);
        setIsTargetedResultsModalOpen(false);
        loadNextSnippetInQueue();
        currentSessionId.current = Date.now().toString();
        requestFocusOnCode();
    }, [loadNextSnippetInQueue, requestFocusOnCode]);


    // Restore session state on mount
    useEffect(() => {
        const sessionResultJSON = localStorage.getItem('sessionResultToShow');
        if (sessionResultJSON) {
            hasRestoredOnMount.current = true;
            localStorage.removeItem('sessionResultToShow');
            try {
                const finishedSession = JSON.parse(sessionResultJSON) as FinishedSessionData;
                setLastStats(finishedSession.stats);
                setIsSessionEndedEarly(finishedSession.isEarlyExit);
                setLastPracticeAction(finishedSession.lastPracticeAction);
                if (finishedSession.currentTargetedKeys && finishedSession.currentTargetedKeys.length > 0) {
                    setCurrentTargetedKeys(finishedSession.currentTargetedKeys);
                    setIsTargetedResultsModalOpen(true);
                } else {
                    setIsResultsModalOpen(true);
                }
            } catch (e) { console.error("Failed to parse session result", e); }
            return;
        }

        const continuedSessionJSON = localStorage.getItem('continuedSession');
        if (continuedSessionJSON) {
            hasRestoredOnMount.current = true;
            localStorage.removeItem('continuedSession');
            try {
                const savedSession = JSON.parse(continuedSessionJSON) as PausedSessionData;
                restorePracticeSession(savedSession.context);
                setSessionToRestore(savedSession);
            } catch (e) { console.error("Failed to parse continued session", e); }
        }
    }, [restorePracticeSession, setCurrentTargetedKeys]);

    useEffect(() => {
        if (game.isFinished && !hasSubmitted && !isResultsModalOpen && !isTargetedResultsModalOpen) {
            setHasSubmitted(true);
            const stats = {
                wpm: game.wpm,
                accuracy: game.accuracy,
                errors: game.errors,
                duration: game.duration,
                errorMap: game.errorMap,
                attemptMap: game.attemptMap
            };
            setLastStats(stats);
            setIsSessionEndedEarly(false);

            let sessionLabel = selectedLanguage.name;
            if (practiceMode === 'error-training') {
                sessionLabel = 'Error Practice';
            } else if (practiceMode === 'targeted') {
                sessionLabel = 'Targeted Practice';
            } else if (practiceMode === 'general') {
                sessionLabel = 'General Typing';
            }

            // Enforce Strict Saving Rules for Uploaded/Custom Snippets
            let shouldSave = true;
            let reason = "";

            if (isCustomSession) {
                // User Requirement: Uploaded code MUST be >= 150 chars AND >= 10s duration
                // even if 100% complete.
                const charsTyped = snippet.length; // 100% complete implies this
                const duration = game.duration;
                if (charsTyped < 150 || duration < 10) {
                    shouldSave = false;
                    reason = "Session not saved: Custom snippets must be >150 chars and >10s duration.";
                }
            }

            if (shouldSave) {
                addPracticeResult({
                    id: currentSessionId.current,
                    date: Date.now(),
                    wpm: game.wpm,
                    accuracy: game.accuracy,
                    duration: game.duration,
                    errors: game.errors,
                    language: sessionLabel,
                    snippetLength: snippet.length,
                    timestamp: Date.now(),
                    linesTyped: game.typedText.split('\n').length,
                    errorMap: game.errorMap,
                    attemptMap: game.attemptMap
                });
                setSaveStatus({ saved: true });
            } else {
                setSaveStatus({ saved: false, reason });
            }

            if (currentTargetedKeys.length > 0) {
                setIsTargetedResultsModalOpen(true);
            } else {
                setIsResultsModalOpen(true);
            }
        } else if (!game.isFinished) {
            setHasSubmitted(false);
        }
    }, [game.isFinished, hasSubmitted, isResultsModalOpen, isTargetedResultsModalOpen, game.wpm, game.accuracy, game.errors, game.duration, game.errorMap, game.attemptMap, addPracticeResult, selectedLanguage.name, snippet.length, currentTargetedKeys]);



    // Frustration Detection
    const [isFrustrated, setIsFrustrated] = useState(false);

    useEffect(() => {
        // Trigger if 10 consecutive errors occurring
        if (game.consecutiveErrors >= 10 && !isFrustrated && !game.isFinished) {
            setIsFrustrated(true);
            gameRef.current.pauseGame();
        }
    }, [game.consecutiveErrors, isFrustrated, game.isFinished]);

    const handleFrustrationRestart = useCallback(() => {
        setIsFrustrated(false);
        resetGame();
    }, [resetGame]);

    const handleShortcuts = useCallback((e: KeyboardEvent) => {
        if (isResultsModalOpen || isTargetedResultsModalOpen || isSetupModalOpen || isFrustrated) return;

        if (e.altKey) {
            switch (e.key.toLowerCase()) {
                case 'c':
                    e.preventDefault();
                    handleCopy();
                    break;
                case 'n':
                    e.preventDefault();
                    handleSetupNew();
                    break;
                case 'e':
                    e.preventDefault();
                    handleEndSession();
                    break;
                case 'r':
                    e.preventDefault();
                    resetGame();
                    break;
                case 'p':
                    e.preventDefault();
                    togglePause();
                    break;
                case 'g':
                    e.preventDefault();
                    toggleHandGuide();
                    break;
                case 'b':
                    e.preventDefault();
                    const currentIndex = blockOnErrorOptions.findIndex(o => o.value === blockOnErrorThreshold);
                    const nextIndex = (currentIndex + 1) % blockOnErrorOptions.length;
                    setBlockOnErrorThreshold(blockOnErrorOptions[nextIndex].value);
                    break;
            }
        }
    }, [isResultsModalOpen, isTargetedResultsModalOpen, isSetupModalOpen, handleSetupNew, handleEndSession, resetGame, togglePause, toggleHandGuide, blockOnErrorThreshold, setBlockOnErrorThreshold]);

    useEffect(() => {
        window.addEventListener('keydown', handleShortcuts);
        return () => window.removeEventListener('keydown', handleShortcuts);
    }, [handleShortcuts]);

    const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768;

    useEffect(() => {
        const handleTypingInput = (e: KeyboardEvent) => {
            const currentGame = gameRef.current;

            if (isResultsModalOpen || isTargetedResultsModalOpen || isSetupModalOpen || isFrustrated || e.altKey || e.ctrlKey || e.metaKey) {
                return;
            }

            if (e.repeat) {
                e.preventDefault();
                return;
            }

            const key = e.key;

            if (key === 'Tab') {
                e.preventDefault();
            }

            if (e.getModifierState("CapsLock")) {
                setIsCapsLockOn(true);
            } else {
                setIsCapsLockOn(false);
            }

            const isPrintable = key.length === 1;
            const isSpecialKey = ['Backspace', 'Enter', 'Tab'].includes(key);

            if (isPrintable || isSpecialKey) {
                e.preventDefault();

                let keyToProcess = key;
                if (isMobile() && key === ' ') {
                    const nextChar = snippet[currentGame.currentIndex];
                    if (nextChar === '\t') {
                        keyToProcess = 'Tab';
                    }
                }

                currentGame.handleKeyDown(keyToProcess);
                requestFocusOnCode();
            }
        };

        window.addEventListener('keydown', handleTypingInput);
        return () => window.removeEventListener('keydown', handleTypingInput);
    }, [isResultsModalOpen, isTargetedResultsModalOpen, isSetupModalOpen, requestFocusOnCode, snippet]);

    const handleEditorValueChange = (newValue: string) => {
        const currentText = gameRef.current.typedText;

        if (newValue.length > currentText.length + 1) {
            const newChars = newValue.slice(currentText.length);
            for (const c of newChars) {
                gameRef.current.handleKeyDown(c);
            }
            requestFocusOnCode();
        }
        else if (newValue.length === currentText.length + 1) {
            let char = newValue.slice(-1);
            if (isMobile() && char === ' ') {
                const nextChar = snippet[gameRef.current.currentIndex];
                if (nextChar === '\t') {
                    char = 'Tab';
                }
            }
            gameRef.current.handleKeyDown(char);
            requestFocusOnCode();
        }
        else if (newValue.length === currentText.length - 1) {
            gameRef.current.handleKeyDown('Backspace');
            requestFocusOnCode();
        }
    };

    // UI FIX: Changed min-h-screen to h-screen and added overflow-hidden to prevent page scrolling
    return (
        <div className="flex flex-col h-[100dvh] max-w-full mx-auto w-full overflow-hidden" ref={gameContainerRef}>
            {isCapsLockOn && (
                <div className="fixed top-20 inset-x-0 z-50 flex justify-center pointer-events-none">
                    <div className="bg-yellow-400 text-yellow-900 px-4 py-2 rounded-md shadow-lg flex items-center gap-2 animate-fade-in-up pointer-events-auto">
                        <WarningIcon className="w-5 h-5" />
                        <span className="font-semibold">Caps Lock is On</span>
                    </div>
                </div>
            )}

            {/* Header / Stats - Glass Card Style */}
            <div className="w-full max-w-[1100px] mx-auto mb-2 pt-2 flex-shrink-0 px-3 md:px-4">
                <div className="glass-card rounded-xl p-3 md:p-4">
                    <StatsDisplay
                        wpm={game.wpm}
                        accuracy={game.accuracy}
                        errors={game.errors}
                        progress={snippet.length > 0 ? Math.round((game.currentIndex / snippet.length) * 100) : 0}
                        timer={game.duration}
                    />
                </div>
            </div>

            {/* Action Bar - Desktop: All buttons, Mobile: Primary + More Menu */}
            <div className="w-full max-w-[1100px] mx-auto mb-2 flex-shrink-0 px-3 md:px-4">
                {/* Desktop Action Bar */}
                <div className="hidden md:flex flex-wrap items-center justify-center gap-2">
                    <Button onClick={handleSetupNew} variant="primary" disabled={isSetupModalOpen} title="New Snippet (Alt+N)" accessKey="n" size="sm" className="btn-press glow-hover">
                        <FileCodeIcon className="w-4 h-4 mr-2" />
                        New
                    </Button>
                    <Button onClick={handleEndSession} variant="outline" disabled={isSetupModalOpen || game.isFinished} title="End Session (Alt+E)" accessKey="e" size="sm" className="btn-press">
                        <XIcon className="w-4 h-4 mr-2" />
                        End
                    </Button>
                    <Button onClick={resetGame} variant="outline" disabled={isSetupModalOpen} title="Reset (Alt+R)" accessKey="r" size="sm" className="btn-press">
                        <ResetIcon className="w-4 h-4 mr-2" />
                        Reset
                    </Button>
                    <Button onClick={togglePause} variant="outline" disabled={isSetupModalOpen || game.isFinished} title={game.isPaused ? "Resume (Alt+P)" : "Pause (Alt+P)"} accessKey="p" size="sm" className="btn-press">
                        {game.isPaused ? <PlayIcon className="w-4 h-4 mr-2" /> : <PauseIcon className="w-4 h-4 mr-2" />}
                        {game.isPaused ? "Resume" : "Pause"}
                    </Button>
                    <Button onClick={handleCopy} variant="outline" disabled={isSetupModalOpen} title="Copy Code (Alt+C)" accessKey="c" size="sm" className="btn-press">
                        {isCopied ? <CheckIcon className="w-4 h-4 mr-2 text-green-500" /> : <CopyIcon className="w-4 h-4 mr-2" />}
                        {isCopied ? "Copied" : "Copy"}
                    </Button>

                    <Dropdown
                        ref={blockOnErrorRef}
                        trigger={
                            <Button variant="outline" title="Block on Error Settings (Alt+B)" accessKey="b" size="sm" className="btn-press">
                                <BlockIcon className="w-4 h-4 mr-2" />
                                <span className="hidden sm:inline">
                                    Block: {blockOnErrorOptions.find(o => o.value === blockOnErrorThreshold)?.label}
                                </span>
                            </Button>
                        }
                    >
                        {blockOnErrorOptions.map(({ label, value }) => (
                            <DropdownItem
                                key={value}
                                onClick={() => { setBlockOnErrorThreshold(value); requestFocusOnCode(); }}
                                isActive={blockOnErrorThreshold === value}
                            >
                                {label}
                            </DropdownItem>
                        ))}
                    </Dropdown>
                    <Button variant="outline" onClick={() => { toggleHandGuide(); requestFocusOnCode(); }} title="Toggle Hand Guide (Alt+G)" disabled={isSetupModalOpen} accessKey="g" size="sm" className="btn-press">
                        <HandGuideIcon className="w-4 h-4 sm:mr-2" />
                        <span className="hidden sm:inline">
                            Hand Guide
                        </span>
                    </Button>
                </div>

                {/* Mobile Action Bar - Simplified */}
                <div className="flex md:hidden items-center justify-center gap-2">
                    <Button onClick={handleSetupNew} variant="primary" disabled={isSetupModalOpen} title="New Snippet" size="sm" className="btn-press glow-hover flex-1 max-w-[140px]">
                        <FileCodeIcon className="w-4 h-4 mr-2" />
                        New
                    </Button>
                    <Button onClick={togglePause} variant="outline" disabled={isSetupModalOpen || game.isFinished} title={game.isPaused ? "Resume" : "Pause"} size="sm" className="btn-press">
                        {game.isPaused ? <PlayIcon className="w-5 h-5" /> : <PauseIcon className="w-5 h-5" />}
                    </Button>
                    <Button onClick={resetGame} variant="outline" disabled={isSetupModalOpen} title="Reset" size="sm" className="btn-press">
                        <ResetIcon className="w-5 h-5" />
                    </Button>
                    <Button
                        onClick={() => setIsMobileMenuOpen(true)}
                        variant="outline"
                        disabled={isSetupModalOpen}
                        title="More Options"
                        size="sm"
                        className="btn-press"
                    >
                        <MoreIcon className="w-5 h-5" />
                    </Button>
                </div>

                {/* Mobile Action Menu (Bottom Sheet) */}
                <MobileActionMenu
                    isOpen={isMobileMenuOpen}
                    onClose={() => setIsMobileMenuOpen(false)}
                    title="More Actions"
                    items={[
                        {
                            label: 'End Session',
                            icon: <XIcon className="w-4 h-4" />,
                            onClick: handleEndSession,
                            disabled: isSetupModalOpen || game.isFinished,
                            shortcut: 'Alt+E'
                        },
                        {
                            label: isCopied ? 'Copied!' : 'Copy Code',
                            icon: isCopied ? <CheckIcon className="w-4 h-4" /> : <CopyIcon className="w-4 h-4" />,
                            onClick: handleCopy,
                            disabled: isSetupModalOpen,
                            shortcut: 'Alt+C'
                        },
                        {
                            label: showHandGuide ? 'Hide Hand Guide' : 'Show Hand Guide',
                            icon: <HandGuideIcon className="w-4 h-4" />,
                            onClick: () => { toggleHandGuide(); requestFocusOnCode(); },
                            disabled: isSetupModalOpen,
                            shortcut: 'Alt+G'
                        },
                        {
                            label: `Error Block: ${blockOnErrorOptions.find(o => o.value === blockOnErrorThreshold)?.label}`,
                            icon: <BlockIcon className="w-4 h-4" />,
                            onClick: () => {
                                const currentIndex = blockOnErrorOptions.findIndex(o => o.value === blockOnErrorThreshold);
                                const nextIndex = (currentIndex + 1) % blockOnErrorOptions.length;
                                setBlockOnErrorThreshold(blockOnErrorOptions[nextIndex].value);
                                requestFocusOnCode();
                            },
                            shortcut: 'Alt+B'
                        },
                    ]}
                />
            </div>

            {/* Code Editor Area - flex-grow ensures it takes remaining space, min-h-0 allows internal scrolling */}
            <div className="w-full mx-auto flex-grow min-h-0 flex flex-col md:flex-row gap-4 overflow-hidden px-4">
                <CodeEditor
                    ref={codeEditorRef}
                    value={game.typedText}
                    onValueChange={handleEditorValueChange}
                    snippet={snippet}
                    languageAlias={selectedLanguage.prismAlias}
                    charStates={game.charStates}
                    currentIndex={game.currentIndex}
                    isError={game.isError}
                    isLoading={isLoadingSnippet}
                    error={snippetError}
                    isPaused={game.isPaused}
                    disabled={isFrustrated}
                    onRetry={() => fetchNewSnippet()}
                    className="flex-grow h-full overflow-y-auto" // Ensure vertical scroll
                />

                {/* Sidebar: Queue */}
                {practiceQueue.length > 1 && (
                    <div className="hidden md:flex flex-col gap-4 w-64 flex-shrink-0 h-full overflow-hidden">
                        <PracticeQueueSidebar />
                    </div>
                )}
            </div>

            {/* Keyboard - flex-shrink-0 keeps it at bottom */}
            {
                showKeyboard && (
                    <div className="flex-shrink-0 w-full max-w-[1100px] mx-auto mt-2 mb-2 px-2">
                        <Keyboard
                            activeKey={nextChar}
                            isShiftActive={/[A-Z!@#$%^&*()_+{}|:"<>?~]/.test(nextChar)}
                            showHandGuide={showHandGuide}
                        />
                    </div>
                )
            }

            <ResultsModal
                isOpen={isResultsModalOpen}
                title={isSessionEndedEarly ? "Session Ended" : "Session Complete"}
                onClose={() => {
                    if (isSessionEndedEarly) {
                        setIsResultsModalOpen(false);
                        requestFocusOnCode();
                    } else {
                        handlePracticeSame();
                    }
                }}
                onPracticeSame={handlePracticeSame}
                onNewSnippet={handleSetupNew}
                onViewProgress={() => {
                    setIsResultsModalOpen(false);
                    navigateTo('dashboard');
                }}
                isCustomSession={isCustomSession}
                lastPracticeAction={lastPracticeAction}
                stats={lastStats}
                isEarlyExit={isSessionEndedEarly}
                onNextSnippet={handleNextSnippet}
                hasNextSnippet={practiceQueue.length > 1 && currentQueueIndex < practiceQueue.length - 1}
                sessionErrorMap={lastStats.errorMap}
                sessionAttemptMap={lastStats.attemptMap}
                saveStatus={saveStatus}
            />

            <TargetedResultsModal
                isOpen={isTargetedResultsModalOpen}
                onClose={() => {
                    setIsTargetedResultsModalOpen(false);
                    requestFocusOnCode();
                }}
                stats={lastStats}
                onPracticeAgain={handlePracticeSame}
                onReturnToDashboard={() => {
                    setIsTargetedResultsModalOpen(false);
                    navigateTo('dashboard');
                }}
                sessionErrorMap={lastStats.errorMap}
                sessionAttemptMap={lastStats.attemptMap}
            />

            <FrustrationModal
                isOpen={isFrustrated}
                onRestart={handleFrustrationRestart}
            />
        </div >
    );
};

export default PracticePage;