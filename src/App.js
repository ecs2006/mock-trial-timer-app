import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { RotateCcw, RefreshCcw, FileText } from 'lucide-react'; // Importing new icons, including FileText for PDF

/**
 * Main App component for the Mock Trial Timer.
 * Manages trial configuration, segment progression, timers, and summary.
 */
const App = () => {
    // State to hold the overall trial configuration, including default durations and witness counts
    const [trialConfig, setTrialConfig] = useState({
        pOpeningDuration: 5 * 60,    // Plaintiff Opening Statement duration (seconds)
        dOpeningDuration: 5 * 60,    // Defense Opening Statement duration (seconds)

        // Overall time budgets for examination types for each side (in seconds)
        pOverallDirectDuration: 25 * 60, // Total time for P's directs + redirects (all P witnesses)
        dOverallCrossDuration: 18 * 60,  // Total time for D's crosses + recrosses (all P witnesses)

        dOverallDirectDuration: 25 * 60, // Total time for D's directs + redirects (all D witnesses)
        pOverallCrossDuration: 18 * 60,  // Total time for P's crosses + recrosses (all D witnesses)

        pClosingDuration: 7 * 60,    // Plaintiff Closing Argument duration (seconds)
        dClosingDuration: 7 * 60,    // Defense Closing Argument duration (seconds)
        maxRebuttalDuration: 3 * 60, // Maximum duration for Rebuttal (P) (seconds)

        plaintiffWitnessCount: 3,    // Number of Plaintiff witnesses
        defenseWitnessCount: 3,      // Number of Defense witnesses
        showTotalSideTimes: false,   // Setting to control visibility of total side times box
    });

    // State to manage the configuration mode (simple or advanced)
    const [configMode, setConfigMode] = useState('simple'); // Default to simple

    // State to hold the dynamically generated sequence of all trial segments
    // Each segment now includes 'actualElapsed' to record time spent.
    const [trialSegments, setTrialSegments] = useState([]);
    // State for the current active segment's index within the trialSegments array
    const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
    // State for the elapsed time of the *current* active segment
    const [currentSegmentElapsed, setCurrentSegmentElapsed] = useState(0);
    // State to track if the timer is currently running
    const [isRunning, setIsRunning] = useState(false);
    // State to control visibility between settings view and timer view
    const [showSettings, setShowSettings] = useState(true);

    // States for managing conditional prompts (redirect/recross)
    const [showRedirectPrompt, setShowRedirectPrompt] = useState(false);
    const [showRecrossPrompt, setShowRecrossPrompt] = useState(false);

    // States for editing segment times or budget times via modal
    const [showEditModal, setShowEditModal] = useState(false);
    // Context for the edit modal: { type: 'segment', segment: segmentObject } or { type: 'budget', budgetKey: 'pOverallDirectDuration' }
    const [editModalContext, setEditModalContext] = useState(null);
    const [editTimeMinutes, setEditTimeMinutes] = useState(0);
    const [editTimeSeconds, setEditTimeSeconds] = useState(0);

    // State for confirmation modals for reset actions
    const [showConfirmResetCurrent, setShowConfirmResetCurrent] = useState(false);
    const [showConfirmFullReset, setShowConfirmFullReset] = useState(false);

    // State to manage loading during PDF generation
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    // New state to track if PDF libraries (html2canvas, jspdf) are loaded
    const [arePdfLibsLoaded, setArePdfLibsLoaded] = useState(false);

    // Ref for the timer interval ID to allow clearing it
    const timerRef = useRef(null);

    // Ref for the Trial Summary div to capture it for PDF
    const trialSummaryRef = useRef(null);

    // Get the current active segment object from the trialSegments array
    const currentSegment = trialSegments[currentSegmentIndex];

    /**
     * Formats total seconds into MM:SS string format.
     * @param {number} totalSeconds - The total number of seconds to format.
     * @returns {string} Formatted time string (MM:SS).
     */
    const formatTime = (totalSeconds) => {
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    };

    /**
     * Callback function for the timer tick. Increments current segment's elapsed time by 1 second.
     */
    const handleTimerTick = useCallback(() => {
        setCurrentSegmentElapsed(prevElapsed => prevElapsed + 1);
    }, []);

    /**
     * Generates the complete sequence of trial segments based on the current `trialConfig`.
     * Each segment is assigned a unique ID, type, side, name, and initial duration/elapsed time.
     * Conditional phases (Redirect, Recross) are marked with `isConditional: true`.
     * @returns {Array<Object>} An array of trial segment objects.
     */
    const generateAllTrialSegments = useCallback(() => {
        const segments = [];
        let idCounter = 0; // Unique ID for each segment

        // 1. Plaintiff Opening
        segments.push({ id: idCounter++, type: 'opening', side: 'plaintiff', name: 'Plaintiff Opening', duration: trialConfig.pOpeningDuration, actualElapsed: 0 });

        // 2. Defense Opening
        segments.push({ id: idCounter++, type: 'opening', side: 'defense', name: 'Defense Opening', duration: trialConfig.dOpeningDuration, actualElapsed: 0 });

        // 3. Plaintiff Witnesses (Direct, Cross, Redirect, Recross for each)
        for (let i = 0; i < trialConfig.plaintiffWitnessCount; i++) {
            segments.push({ id: idCounter++, type: 'direct', side: 'plaintiff', witnessIndex: i, name: `P Witness ${i + 1} - Direct`, duration: Infinity, actualElapsed: 0 });
            segments.push({ id: idCounter++, type: 'cross', side: 'defense', witnessIndex: i, name: `P Witness ${i + 1} - Cross`, duration: Infinity, actualElapsed: 0 });
            // Conditional phases for prompt:
            segments.push({ id: idCounter++, type: 'redirect', side: 'plaintiff', witnessIndex: i, name: `P Witness ${i + 1} - Redirect`, duration: Infinity, isConditional: true, actualElapsed: 0 });
            segments.push({ id: idCounter++, type: 'recross', side: 'defense', witnessIndex: i, name: `P Witness ${i + 1} - Recross`, duration: Infinity, isConditional: true, actualElapsed: 0 });
        }

        // 4. Defense Witnesses (Direct, Cross, Redirect, Recross for each)
        for (let i = 0; i < trialConfig.defenseWitnessCount; i++) {
            segments.push({ id: idCounter++, type: 'direct', side: 'defense', witnessIndex: i, name: `D Witness ${i + 1} - Direct`, duration: Infinity, actualElapsed: 0 });
            segments.push({ id: idCounter++, type: 'cross', side: 'plaintiff', witnessIndex: i, name: `D Witness ${i + 1} - Cross`, duration: Infinity, actualElapsed: 0 });
            // Conditional phases for prompt:
            segments.push({ id: idCounter++, type: 'redirect', side: 'defense', witnessIndex: i, name: `D Witness ${i + 1} - Redirect`, duration: Infinity, isConditional: true, actualElapsed: 0 });
            segments.push({ id: idCounter++, type: 'recross', side: 'plaintiff', witnessIndex: i, name: `D Witness ${i + 1} - Recross`, duration: Infinity, isConditional: true, actualElapsed: 0 });
        }

        // 5. Plaintiff Closing
        segments.push({ id: idCounter++, type: 'closing', side: 'plaintiff', name: 'Plaintiff Closing', duration: trialConfig.pClosingDuration, actualElapsed: 0 });

        // 6. Defense Closing
        segments.push({ id: idCounter++, type: 'closing', side: 'defense', name: 'Defense Closing', duration: trialConfig.dClosingDuration, actualElapsed: 0 });

        // 7. Rebuttal (Plaintiff) - has a max duration, but its effective duration is dynamic
        segments.push({ id: idCounter++, type: 'rebuttal', side: 'plaintiff', name: 'Rebuttal', duration: Infinity, actualElapsed: 0 });

        // 8. End of Trial marker
        segments.push({ id: idCounter++, type: 'end', name: 'Trial Ended', duration: 0, actualElapsed: 0 });

        return segments;
    }, [
        trialConfig.pOpeningDuration, trialConfig.dOpeningDuration,
        trialConfig.plaintiffWitnessCount, trialConfig.defenseWitnessCount,
        trialConfig.pClosingDuration, trialConfig.dClosingDuration, trialConfig.maxRebuttalDuration
    ]);

    /**
     * Helper function to save the current segment's elapsed time into `trialSegments` state.
     * This is crucial before moving to the next or previous segment, or when a prompt is triggered.
     */
    const saveCurrentSegmentTime = useCallback(() => {
        if (currentSegment && currentSegment.type !== 'end') {
            setTrialSegments(prevSegments => {
                const newSegments = [...prevSegments];
                newSegments[currentSegmentIndex] = { ...newSegments[currentSegmentIndex], actualElapsed: currentSegmentElapsed };
                return newSegments;
            });
        }
    }, [currentSegment, currentSegmentIndex, currentSegmentElapsed]);

    /**
     * Advances the trial to the next segment.
     * Handles saving the current segment's time, checking for conditional prompts (redirect/recross),
     * and skipping conditional segments if they were previously marked as skipped (actualElapsed is 0).
     */
    const moveToNextSegment = useCallback(() => {
        setIsRunning(false); // Pause timer before moving

        saveCurrentSegmentTime(); // Save the current segment's time *before* potential prompt or moving

        // --- Prompt Logic: Check if a prompt should be shown after *this* segment completes ---
        if (currentSegment && currentSegment.type === 'cross') {
            const nextPotentialSegment = trialSegments[currentSegmentIndex + 1];
            if (nextPotentialSegment && nextPotentialSegment.type === 'redirect' &&
                nextPotentialSegment.witnessIndex === currentSegment.witnessIndex) {
                setShowRedirectPrompt(true);
                return; // STOP execution of moveToNextSegment here, wait for prompt input
            }
        }

        if (currentSegment && currentSegment.type === 'redirect') {
            const nextPotentialSegment = trialSegments[currentSegmentIndex + 1];
            if (nextPotentialSegment && nextPotentialSegment.type === 'recross' &&
                nextPotentialSegment.witnessIndex === currentSegment.witnessIndex) {
                setShowRecrossPrompt(true);
                return; // STOP execution of moveToNextSegment here, wait for prompt input
            }
        }
        // --- End Prompt Logic ---

        // If no prompt was triggered, proceed with normal advancement
        let nextIndex = currentSegmentIndex + 1;

        // This loop handles skipping conditional segments if they were explicitly decided as "No"
        // (meaning their actualElapsed is 0, set by prompt handlers), or if we are simply advancing
        // past them because they are conditional and don't require a prompt at this exact point.
        while (nextIndex < trialSegments.length && trialSegments[nextIndex].isConditional && trialSegments[nextIndex].actualElapsed === 0) {
            // We only skip if it's for the same witness AND it's a conditional phase that has not been taken (actualElapsed is 0)
            if (trialSegments[nextIndex].witnessIndex === currentSegment?.witnessIndex &&
                trialSegments[nextIndex].side === currentSegment?.side) {
                nextIndex++;
            } else {
                break; // Stop skipping if the conditional segment is for a new witness or not related
            }
        }

        if (nextIndex < trialSegments.length) {
            setCurrentSegmentIndex(nextIndex);
            // Crucial fix: Load actualElapsed for the *new* current segment, don't just reset to 0
            setCurrentSegmentElapsed(trialSegments[nextIndex].actualElapsed || 0);
        } else {
            setCurrentSegmentIndex(trialSegments.length - 1); // Go to 'Trial Ended'
            setCurrentSegmentElapsed(0);
        }
    }, [currentSegmentIndex, currentSegment, trialSegments, saveCurrentSegmentTime]);

    /**
     * Moves the trial to the previous segment.
     * Handles saving the current segment's time and intelligently moving back past skipped conditional segments.
     */
    const moveToPreviousSegment = useCallback(() => {
        setIsRunning(false); // Pause timer

        saveCurrentSegmentTime(); // Save current segment's elapsed time before moving back

        if (currentSegmentIndex > 0) {
            let prevIndex = currentSegmentIndex - 1;

            // If moving back from a phase, find the actual previous non-skipped or conditional segment
            // for the same witness.
            while (prevIndex >= 0 && trialSegments[prevIndex].isConditional && trialSegments[prevIndex].actualElapsed === 0 &&
                (trialSegments[prevIndex].witnessIndex === currentSegment?.witnessIndex &&
                    trialSegments[prevIndex].side === currentSegment?.side)) {
                prevIndex--;
            }

            setCurrentSegmentIndex(prevIndex);
            // Set elapsed time of the segment we are going back to, or 0 if it was skipped/not started
            setCurrentSegmentElapsed(trialSegments[prevIndex]?.actualElapsed || 0);

        } else {
            // If already at the first segment, just reset its elapsed time to 0
            setCurrentSegmentElapsed(0);
        }
    }, [currentSegmentIndex, currentSegment, trialSegments, saveCurrentSegmentTime]);

    /**
     * Effect to manage the main timer interval.
     * Clears the interval when `isRunning` is false or component unmounts.
     */
    useEffect(() => {
        if (isRunning) {
            timerRef.current = setInterval(handleTimerTick, 1000);
        } else {
            clearInterval(timerRef.current);
        }
        // Cleanup function to clear interval on component unmount or dependency changes
        return () => clearInterval(timerRef.current);
    }, [isRunning, handleTimerTick]);

    /**
     * Effect to handle segment completion for fixed-duration phases (Openings, Closings, Rebuttal).
     * This effect no longer automatically pauses the timer when time runs out.
     * The `STOP` message and `Overtime` display handle visual feedback.
     */
    useEffect(() => {
        // Removed the setIsRunning(false) here. The timer will continue to tick
        // beyond the duration, and the displayRemainingTime useMemo will show "STOP" and "Overtime".
    }, [currentSegmentElapsed, isRunning, currentSegment]);

    // Effect to dynamically load html2canvas and jspdf scripts
    useEffect(() => {
        const loadScript = (src, id, onLoaded) => {
            // Check if script already exists to prevent duplicate loading
            if (document.getElementById(id)) {
                onLoaded(); // Treat as loaded if already in DOM
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.id = id;
            script.onload = onLoaded;
            script.onerror = () => console.error(`Failed to load script: ${src}`);
            document.head.appendChild(script);
        };

        let loadedCount = 0;
        const totalScripts = 2; // Need to load both html2canvas and jspdf

        const onScriptLoaded = () => {
            loadedCount++;
            if (loadedCount === totalScripts) {
                // Verify that the global objects are actually available after scripts load
                if (window.html2canvas && window.jspdf && window.jspdf.jsPDF) {
                    setArePdfLibsLoaded(true);
                    console.log("PDF libraries html2canvas and jspdf loaded successfully.");
                } else {
                    console.error("PDF libraries loaded, but global objects (html2canvas, jspdf) not found.");
                }
            }
        };

        // Load html2canvas
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js", "html2canvas-script", onScriptLoaded);
        // Load jsPDF
        loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js", "jspdf-script", onScriptLoaded);

        // Cleanup function to remove scripts if component unmounts (optional, but good practice)
        return () => {
            const html2canvasScript = document.getElementById("html2canvas-script");
            const jspdfScript = document.getElementById("jspdf-script");
            if (html2canvasScript && html2canvasScript.parentNode) {
                html2canvasScript.parentNode.removeChild(html2canvasScript);
            }
            if (jspdfScript && jspdfScript.parentNode) {
                jspdfScript.parentNode.removeChild(jspdfScript);
            }
        };
    }, []); // Empty dependency array means this runs once on mount


    /**
     * Toggles the timer's running state (start/pause).
     * Prevents starting if a prompt is active or the trial has ended.
     */
    const toggleTimer = () => {
        if (showRedirectPrompt || showRecrossPrompt || (currentSegment && currentSegment.type === 'end')) {
            return;
        }
        setIsRunning(prevIsRunning => !prevIsRunning);
    };

    /**
     * Initiates the confirmation process for resetting the current phase.
     * Pauses the timer and displays a confirmation modal.
     */
    const requestResetCurrentPhase = () => {
        setIsRunning(false); // Pause immediately
        setShowConfirmResetCurrent(true);
    };

    /**
     * Confirms and performs the reset of the current phase.
     * Resets the `currentSegmentElapsed` to 0.
     */
    const confirmResetCurrentPhase = () => {
        setShowConfirmResetCurrent(false);
        setCurrentSegmentElapsed(0); // Reset elapsed time for the current segment
        // Also update the actualElapsed in the trialSegments array for summary
        setTrialSegments(prevSegments => {
            const newSegments = [...prevSegments];
            if (newSegments[currentSegmentIndex]) {
                newSegments[currentSegmentIndex] = { ...newSegments[currentSegmentIndex], actualElapsed: 0 };
            }
            return newSegments;
        });
    };

    /**
     * Initiates the confirmation process for a full trial reset.
     * Pauses the timer and displays a confirmation modal.
     */
    const requestFullReset = () => {
        setIsRunning(false); // Pause immediately
        setShowConfirmFullReset(true);
    };

    /**
     * Confirms and performs a full trial reset.
     * Resets all timer states, clears segments, and returns to settings.
     */
    const confirmFullReset = () => {
        setShowConfirmFullReset(false);
        setIsRunning(false);
        setCurrentSegmentIndex(0);
        setCurrentSegmentElapsed(0);
        setTrialSegments([]); // Clear generated segments
        setShowSettings(true); // Show settings again after full reset
        setShowRedirectPrompt(false); // Hide any active prompts
        setShowRecrossPrompt(false); // Hide any active prompts
    };

    /**
     * Handles updating duration values from settings. Converts minutes to seconds.
     * In simple mode, updates both Plaintiff and Defense values symmetrically.
     * @param {string} key - The key in `trialConfig` to update.
     * @param {string} value - The input value (in minutes).
     */
    const handleDurationChange = (key, value) => {
        const seconds = Math.max(0, parseInt(value, 10) * 60 || 0);
        setTrialConfig(prevConfig => {
            if (configMode === 'simple') {
                const newConfig = { ...prevConfig };
                switch (key) {
                    case 'pOpeningDuration':
                    case 'dOpeningDuration':
                        newConfig.pOpeningDuration = seconds;
                        newConfig.dOpeningDuration = seconds;
                        break;
                    case 'pOverallDirectDuration':
                    case 'dOverallDirectDuration':
                        newConfig.pOverallDirectDuration = seconds;
                        newConfig.dOverallDirectDuration = seconds;
                        break;
                    case 'dOverallCrossDuration':
                    case 'pOverallCrossDuration':
                        newConfig.dOverallCrossDuration = seconds;
                        newConfig.pOverallCrossDuration = seconds;
                        break;
                    case 'pClosingDuration':
                    case 'dClosingDuration':
                        newConfig.pClosingDuration = seconds;
                        newConfig.dClosingDuration = seconds;
                        break;
                    default:
                        newConfig[key] = seconds;
                }
                return newConfig;
            } else {
                return { ...prevConfig, [key]: seconds };
            }
        });
    };

    /**
     * Handles updating witness count values from settings.
     * In simple mode, updates both Plaintiff and Defense witness counts symmetrically.
     * @param {string} key - The key in `trialConfig` to update.
     * @param {string} value - The input value (number of witnesses).
     */
    const handleWitnessCountChange = (key, value) => {
        const count = Math.max(0, parseInt(value, 10) || 0);
        setTrialConfig(prevConfig => {
            if (configMode === 'simple') {
                return {
                    ...prevConfig,
                    plaintiffWitnessCount: count,
                    defenseWitnessCount: count,
                };
            } else {
                return { ...prevConfig, [key]: count };
            }
        });
    };

    /**
     * Toggles the `showTotalSideTimes` setting in `trialConfig`.
     */
    const handleToggleShowTotalSideTimes = () => {
        setTrialConfig(prevConfig => ({
            ...prevConfig,
            showTotalSideTimes: !prevConfig.showTotalSideTimes,
        }));
    };

    /**
     * Initiates the trial from the settings screen.
     * Generates all segments, sets initial timer states, and switches to the timer view.
     */
    const startTrial = () => {
        const generatedSegments = generateAllTrialSegments();
        setTrialSegments(generatedSegments);
        setCurrentSegmentIndex(0); // Start from the first generated segment
        setCurrentSegmentElapsed(0);
        setShowSettings(false); // Hide settings, show the timer view
        setIsRunning(false); // Timer starts paused, user clicks play
    };

    /**
     * Helper function to determine if a given segment contributes to a specific overall budget key.
     * Used for calculating budget usage for examination phases.
     * @param {Object} segment - The trial segment object.
     * @param {string} budgetKey - The budget key (e.g., 'pOverallDirectDuration').
     * @returns {boolean} True if the segment contributes to the budget, false otherwise.
     */
    const doesSegmentContributeToBudget = useCallback((segment, budgetKey) => {
        const isDirectType = segment.type === 'direct' || segment.type === 'redirect';
        const isCrossType = segment.type === 'cross' || segment.type === 'recross';

        switch (budgetKey) {
            case 'pOverallDirectDuration': return isDirectType && segment.side === 'plaintiff';
            case 'dOverallCrossDuration': return isCrossType && segment.side === 'defense' && segment.name.includes('P Witness');
            case 'dOverallDirectDuration': return isDirectType && segment.side === 'defense';
            case 'pOverallCrossDuration': return isCrossType && segment.side === 'plaintiff' && segment.name.includes('D Witness');
            default: return false;
        }
    }, []);

    /**
     * Handles the decision from the "Redirect" prompt.
     * If 'Yes', moves to the Redirect phase. If 'No', skips Redirect and Recross for that witness.
     * Marks skipped segments' `actualElapsed` as 0 for the summary.
     * @param {boolean} proceedWithRedirect - True if the user wants to take redirect, false otherwise.
     */
    const handleRedirectDecisionPrompt = useCallback((proceedWithRedirect) => {
        setShowRedirectPrompt(false); // Close the prompt

        let nextIndexToAdvanceTo;
        if (proceedWithRedirect) {
            // User chose Yes, so go to the immediate next segment (Redirect)
            nextIndexToAdvanceTo = currentSegmentIndex + 1;
        } else {
            // User chose No, skip Redirect and Recross for this witness
            // Find the next segment that is NOT a redirect or recross for the current witness
            let tempIndex = currentSegmentIndex + 3;
            while (tempIndex < trialSegments.length &&
                   (trialSegments[tempIndex].type === 'redirect' || trialSegments[tempIndex].type === 'recross') &&
                   trialSegments[tempIndex].witnessIndex === currentSegment.witnessIndex &&
                   trialSegments[tempIndex].side === currentSegment.side) {
                setTrialSegments(prevSegments => {
                    const newSegments = [...prevSegments];
                    newSegments[tempIndex] = { ...newSegments[tempIndex], actualElapsed: 0 }; // Mark as skipped
                    return newSegments;
                });
                tempIndex++;
            }
            nextIndexToAdvanceTo = tempIndex; // The index after the skipped redirect/recross pair
        }

        setCurrentSegmentIndex(nextIndexToAdvanceTo);
        // Load the actual elapsed time of the segment we are moving to, or 0 if it's new/skipped
        setCurrentSegmentElapsed(trialSegments[nextIndexToAdvanceTo]?.actualElapsed || 0);
        setIsRunning(false); // Ensure timer remains paused after decision
    }, [currentSegment, currentSegmentIndex, trialSegments]);

    /**
     * Handles the decision from the "Recross" prompt.
     * If 'Yes', moves to the Recross phase. If 'No', skips Recross for that witness.
     * Marks skipped segments' `actualElapsed` as 0 for the summary.
     * @param {boolean} proceedWithRecross - True if the user wants to take recross, false otherwise.
     */
    const handleRecrossDecisionPrompt = useCallback((proceedWithRecross) => {
        setShowRecrossPrompt(false); // Close the prompt

        let nextIndexToAdvanceTo;
        if (proceedWithRecross) {
            // User chose Yes, so go to the immediate next segment (Recross)
            nextIndexToAdvanceTo = currentSegmentIndex + 1;
        } else {
            // User chose No, skip Recross for this witness
            // Find the next segment that is NOT a recross for the current witness
            let tempIndex = currentSegmentIndex + 1;
            while (tempIndex < trialSegments.length &&
                   trialSegments[tempIndex].type === 'recross' &&
                   trialSegments[tempIndex].witnessIndex === currentSegment.witnessIndex &&
                   trialSegments[tempIndex].side === currentSegment.side) {
                setTrialSegments(prevSegments => {
                    const newSegments = [...prevSegments];
                    newSegments[tempIndex] = { ...newSegments[tempIndex], actualElapsed: 0 }; // Mark as skipped
                    return newSegments;
                });
                tempIndex++;
            }
            nextIndexToAdvanceTo = tempIndex; // The index after the skipped recross
        }

        setCurrentSegmentIndex(nextIndexToAdvanceTo);
        // Load the actual elapsed time of the segment we are moving to, or 0 if it's new/skipped
        setCurrentSegmentElapsed(trialSegments[nextIndexToAdvanceTo]?.actualElapsed || 0);
        setIsRunning(false); // Ensure timer remains paused after decision
    }, [currentSegment, currentSegmentIndex, trialSegments]);

    /**
     * Calculates the total elapsed times for overall direct/cross examination budgets
     * based on recorded `actualElapsed` times in `trialSegments`.
     * Also calculates time used by segments *before* the current active one for budget display.
     * Memoized for performance.
     * @returns {Object} An object containing various budget usage totals.
     */
    const { pDirectUsed, dCrossUsed, dDirectUsed, pCrossUsed, pDirectUsedBeforeCurrent, dCrossUsedBeforeCurrent, dDirectUsedBeforeCurrent, pCrossUsedBeforeCurrent } = useMemo(() => {
        let pDirectUsed = 0; // Total P direct/redirect time from all P witnesses
        let dCrossUsed = 0;  // Total D cross/recross time from all P witnesses
        let dDirectUsed = 0; // Total D direct/redirect time from all D witnesses
        let pCrossUsed = 0;  // Total P cross/recross time from all D witnesses

        let pDirectUsedBeforeCurrent = 0;
        let dCrossUsedBeforeCurrent = 0;
        let dDirectUsedBeforeCurrent = 0;
        let pCrossUsedBeforeCurrent = 0;

        trialSegments.forEach((segment, index) => {
            // Accumulate total used time for each category (includes current segment's actualElapsed if it was saved)
            if (segment.actualElapsed > 0) { // Only count if time was actually spent
                if (doesSegmentContributeToBudget(segment, 'pOverallDirectDuration')) pDirectUsed += segment.actualElapsed;
                if (doesSegmentContributeToBudget(segment, 'dOverallCrossDuration')) dCrossUsed += segment.actualElapsed;
                if (doesSegmentContributeToBudget(segment, 'dOverallDirectDuration')) dDirectUsed += segment.actualElapsed;
                if (doesSegmentContributeToBudget(segment, 'pOverallCrossDuration')) pCrossUsed += segment.actualElapsed;
            }

            // Accumulate time for segments *before* the current active one
            if (index < currentSegmentIndex && segment.actualElapsed > 0) {
                if (doesSegmentContributeToBudget(segment, 'pOverallDirectDuration')) pDirectUsedBeforeCurrent += segment.actualElapsed;
                if (doesSegmentContributeToBudget(segment, 'dOverallCrossDuration')) dCrossUsedBeforeCurrent += segment.actualElapsed;
                if (doesSegmentContributeToBudget(segment, 'dOverallDirectDuration')) dDirectUsedBeforeCurrent += segment.actualElapsed;
                if (doesSegmentContributeToBudget(segment, 'pOverallCrossDuration')) pCrossUsedBeforeCurrent += segment.actualElapsed;
            }
        });

        // Add currentSegmentElapsed to the total 'used' budgets if current segment is an examination phase
        // This accounts for the time actively running on the timer.
        if (currentSegmentElapsed > 0 && currentSegment && currentSegment.duration === Infinity) {
            if (doesSegmentContributeToBudget(currentSegment, 'pOverallDirectDuration')) pDirectUsed += currentSegmentElapsed;
            if (doesSegmentContributeToBudget(currentSegment, 'dOverallCrossDuration')) dCrossUsed += currentSegmentElapsed;
            if (doesSegmentContributeToBudget(currentSegment, 'dOverallDirectDuration')) dDirectUsed += currentSegmentElapsed;
            if (doesSegmentContributeToBudget(currentSegment, 'pOverallCrossDuration')) pCrossUsed += currentSegmentElapsed;
        }

        return {
            pDirectUsed, dCrossUsed, dDirectUsed, pCrossUsed,
            pDirectUsedBeforeCurrent, dCrossUsedBeforeCurrent, dDirectUsedBeforeCurrent, pCrossUsedBeforeCurrent
        };
    }, [trialSegments, currentSegment, currentSegmentElapsed, currentSegmentIndex, doesSegmentContributeToBudget]);

    /**
     * Calculates the actual elapsed times for fixed phases (Opening, Closing, Rebuttal).
     * Memoized for performance.
     * @returns {Object} An object containing used times for fixed phases.
     */
    const { pOpeningUsed, dOpeningUsed, pClosingUsed, dClosingUsed, pRebuttalUsed } = useMemo(() => {
        let pOpeningUsed = 0;
        let dOpeningUsed = 0;
        let pClosingUsed = 0;
        let dClosingUsed = 0;
        let pRebuttalUsed = 0;

        trialSegments.forEach(segment => {
            if (segment.actualElapsed > 0) {
                if (segment.type === 'opening' && segment.side === 'plaintiff') pOpeningUsed += segment.actualElapsed;
                if (segment.type === 'opening' && segment.side === 'defense') dOpeningUsed += segment.actualElapsed;
                if (segment.type === 'closing' && segment.side === 'plaintiff') pClosingUsed += segment.actualElapsed;
                if (segment.type === 'closing' && segment.side === 'defense') dClosingUsed += segment.actualElapsed;
                if (segment.type === 'rebuttal' && segment.side === 'plaintiff') pRebuttalUsed += segment.actualElapsed;
            }
        });
        return { pOpeningUsed, dOpeningUsed, pClosingUsed, dClosingUsed, pRebuttalUsed };
    }, [trialSegments]);

    /**
     * Calculates the total elapsed time for the Plaintiff's side across all phases.
     * This sums P's opening, P's directs/redirects (on P witnesses),
     * P's crosses/recrosses (on D witnesses), P's closing, and rebuttal.
     * Memoized for performance.
     * @returns {number} Total elapsed seconds for Plaintiff.
     */
    const derivedTotalPlaintiffElapsed = useMemo(() => {
        return trialSegments.reduce((sum, segment) => {
            if (segment.actualElapsed > 0) {
                if (segment.side === 'plaintiff' && (segment.type === 'opening' || segment.type === 'closing' || segment.type === 'rebuttal' || segment.type === 'direct' || segment.type === 'redirect')) {
                    return sum + segment.actualElapsed;
                } else if (segment.side === 'plaintiff' && (segment.type === 'cross' || segment.type === 'recross') && segment.name.includes('D Witness')) {
                    return sum + segment.actualElapsed;
                }
            }
            return sum;
        }, 0);
    }, [trialSegments]);

    /**
     * Calculates the total elapsed time for the Defense's side across all phases.
     * This sums D's opening, D's directs/redirects (on D witnesses),
     * D's crosses/recrosses (on P witnesses), and D's closing.
     * Memoized for performance.
     * @returns {number} Total elapsed seconds for Defense.
     */
    const derivedTotalDefenseElapsed = useMemo(() => {
        return trialSegments.reduce((sum, segment) => {
            if (segment.actualElapsed > 0) {
                if (segment.side === 'defense' && (segment.type === 'opening' || segment.type === 'closing' || segment.type === 'direct' || segment.type === 'redirect')) {
                    return sum + segment.actualElapsed;
                } else if (segment.side === 'defense' && (segment.type === 'cross' || segment.type === 'recross') && segment.name.includes('P Witness')) {
                    return sum + segment.actualElapsed;
                }
            }
            return sum;
        }, 0);
    }, [trialSegments]);

    /**
     * Determines the remaining time for the current segment, considering fixed durations or overall budgets.
     * Memoized for performance.
     * @returns {Object} An object containing the remaining value, type ('fixed' or 'budget'), budget key,
     * time used before current segment (for budget type), and total budget, and new 'overtime' property.
     */
    const displayRemainingTime = useMemo(() => {
        if (!currentSegment) return { value: 0, type: 'N/A', budgetKey: null, usedBeforeCurrentSegment: 0, totalBudget: 0, overtime: 0 };

        let remaining = 0;
        let totalBudgetCalculated = 0;
        let usedBeforeCurrentSegmentCalculated = 0;
        let budgetKey = null;
        let type = 'N/A';
        let currentOvertime = 0; // Initialize overtime

        if (currentSegment.duration !== Infinity) {
            // Fixed duration segments (Opening, Closing, Rebuttal)
            totalBudgetCalculated = currentSegment.duration;
            remaining = totalBudgetCalculated - currentSegmentElapsed;
            type = 'fixed';

            // Calculate overtime for fixed segments
            if (remaining < 0) {
                currentOvertime = -remaining;
                remaining = 0; // Ensure remaining doesn't go negative in display
            }
        } else {
            // Examination segments (Direct, Cross, Redirect, Recross) drawing from an overall budget

            if (currentSegment.type === 'rebuttal') {
                const pClosingSegment = trialSegments.find(s => s.type === 'closing' && s.side === 'plaintiff');
                const pClosingActualElapsed = pClosingSegment ? pClosingSegment.actualElapsed : 0;

                totalBudgetCalculated = Math.max(
                    0,
                    Math.min(
                        trialConfig.maxRebuttalDuration,
                        trialConfig.pClosingDuration - pClosingActualElapsed
                    )
                );
                remaining = totalBudgetCalculated - currentSegmentElapsed;
                type = 'fixed'; // Treat rebuttal like fixed for remaining/overtime calc based on its dynamic budget

                // Calculate overtime for rebuttal
                if (remaining < 0) {
                    currentOvertime = -remaining;
                    remaining = 0;
                }
            } else {
                // Budget-based segments
                if (doesSegmentContributeToBudget(currentSegment, 'pOverallDirectDuration')) {
                    totalBudgetCalculated = trialConfig.pOverallDirectDuration;
                    usedBeforeCurrentSegmentCalculated = pDirectUsedBeforeCurrent;
                    budgetKey = 'pOverallDirectDuration';
                } else if (doesSegmentContributeToBudget(currentSegment, 'dOverallCrossDuration')) {
                    totalBudgetCalculated = trialConfig.dOverallCrossDuration;
                    usedBeforeCurrentSegmentCalculated = dCrossUsedBeforeCurrent;
                    budgetKey = 'dOverallCrossDuration';
                } else if (doesSegmentContributeToBudget(currentSegment, 'dOverallDirectDuration')) {
                    totalBudgetCalculated = trialConfig.dOverallDirectDuration;
                    usedBeforeCurrentSegmentCalculated = dDirectUsedBeforeCurrent;
                    budgetKey = 'dOverallDirectDuration';
                } else if (doesSegmentContributeToBudget(currentSegment, 'pOverallCrossDuration')) {
                    totalBudgetCalculated = trialConfig.pOverallCrossDuration;
                    usedBeforeCurrentSegmentCalculated = pCrossUsedBeforeCurrent;
                    budgetKey = 'pOverallCrossDuration';
                }
                type = 'budget';

                // Remaining budget calculation
                remaining = totalBudgetCalculated - (usedBeforeCurrentSegmentCalculated + currentSegmentElapsed);

                // Calculate overtime for budget segments
                if (remaining < 0) {
                    currentOvertime = -remaining;
                    remaining = 0; // Ensure remaining doesn't go negative
                }
            }
        }

        return {
            value: remaining,
            type: type,
            budgetKey: budgetKey,
            usedBeforeCurrentSegment: usedBeforeCurrentSegmentCalculated,
            totalBudget: totalBudgetCalculated,
            overtime: currentOvertime // Return the calculated overtime
        };
    }, [currentSegment, currentSegmentElapsed, trialConfig, pDirectUsedBeforeCurrent, dCrossUsedBeforeCurrent, dDirectUsedBeforeCurrent, pCrossUsedBeforeCurrent, doesSegmentContributeToBudget, trialSegments]);


    /**
     * Opens the edit time modal, pausing the timer and setting the modal's context
     * and initial time values based on what is being edited.
     * @param {Object} context - Object defining what is being edited:
     * `{ type: 'segment', segment: segmentObject }`
     * `{ type: 'budget', budgetKey: string, usedBeforeCurrentSegment: number, currentTotalBudget: number }`
     * `{ type: 'fixed-remaining-edit', segment: segmentObject, originalDuration: number }`
     */
    const openEditModal = (context) => {
        setIsRunning(false); // Pause timer if running when opening modal
        setEditModalContext(context);

        let initialTimeInSeconds = 0;
        if (context.type === 'segment') {
            // When editing a specific segment's elapsed time
            initialTimeInSeconds = (context.segment.id === currentSegment?.id) ? currentSegmentElapsed : context.segment.actualElapsed;
        } else if (context.type === 'budget' || context.type === 'fixed-remaining-edit') {
            // When editing a budget's remaining time or a fixed segment's remaining time,
            // the modal should initially show the *current remaining* time.
            initialTimeInSeconds = displayRemainingTime.value;
        }

        setEditTimeMinutes(Math.floor(initialTimeInSeconds / 60));
        setEditTimeSeconds(initialTimeInSeconds % 60);
        setShowEditModal(true);
    };

    /**
     * Closes the edit time modal and clears its context.
     */
    const closeEditModal = () => {
        setShowEditModal(false);
        setEditModalContext(null);
        setEditTimeMinutes(0);
        setEditTimeSeconds(0);
    };

    /**
     * Handles saving the time changes made in the edit modal.
     * This logic is crucial for correctly updating either:
     * 1. A specific segment's `actualElapsed` time.
     * 2. The *remaining* time of an overall budget (which impacts `currentSegmentElapsed` and potentially past `actualElapsed` values).
     * 3. The *remaining* time of a fixed-duration segment.
     */
    const handleEditTimeSave = () => {
        if (!editModalContext) return;

        const newTimeInSecondsFromModal = (parseInt(editTimeMinutes, 10) * 60) + parseInt(editTimeSeconds, 10);

        if (editModalContext.type === 'segment') {
            // Case 1: Editing a specific segment's actual elapsed time
            setTrialSegments(prevSegments => {
                const updatedSegments = prevSegments.map(seg =>
                    seg.id === editModalContext.segment.id ? { ...seg, actualElapsed: newTimeInSecondsFromModal } : seg
                );
                return updatedSegments;
            });
            // If the edited segment is the currently active one, update its elapsed time too
            if (editModalContext.segment.id === currentSegment?.id) {
                setCurrentSegmentElapsed(newTimeInSecondsFromModal);
            }
        } else if (editModalContext.type === 'budget') {
            // Case 2: Setting the *remaining* time for an overall budget (e.g., P. Directs)
            const totalBudget = trialConfig[editModalContext.budgetKey]; // Original total budget for this category
            const usedBeforeCurrentSegment = editModalContext.usedBeforeCurrentSegment; // Time used by previous segments in this budget

            // Desired total used time for this budget category (up to and including current segment)
            const desiredTotalUsed = totalBudget - newTimeInSecondsFromModal;

            // Calculate how much the current segment should have elapsed
            let calculatedCurrentSegmentElapsed = desiredTotalUsed - usedBeforeCurrentSegment;

            // If `calculatedCurrentSegmentElapsed` is negative, it means the desired remaining time
            // implies that *less* time should have been used than what's already recorded
            // in *previous* segments (usedBeforeCurrentSegment).
            // In this scenario, we must "undo" some time from previous segments.
            if (calculatedCurrentSegmentElapsed < 0) {
                let excessToRemove = -calculatedCurrentSegmentElapsed; // Amount by which previous usage needs to be reduced
                calculatedCurrentSegmentElapsed = 0; // Current segment's elapsed time becomes 0 or minimum

                setTrialSegments(prevSegments => {
                    const newSegments = [...prevSegments];
                    // Iterate backwards through segments BEFORE the current one to reduce their actualElapsed
                    for (let i = currentSegmentIndex - 1; i >= 0 && excessToRemove > 0; i--) {
                        const segment = newSegments[i];
                        // Only modify segments that contribute to this specific budget and have recorded time
                        if (doesSegmentContributeToBudget(segment, editModalContext.budgetKey) && segment.actualElapsed > 0) {
                            const canDeduct = Math.min(excessToRemove, segment.actualElapsed);
                            newSegments[i] = { ...segment, actualElapsed: segment.actualElapsed - canDeduct };
                            excessToRemove -= canDeduct;
                        }
                    }
                    return newSegments;
                });
            } else {
                // Ensure current segment's elapsed time doesn't exceed its "allotted" portion
                // (total budget minus previous usage)
                calculatedCurrentSegmentElapsed = Math.min(calculatedCurrentSegmentElapsed, totalBudget - usedBeforeCurrentSegment);
            }

            setCurrentSegmentElapsed(calculatedCurrentSegmentElapsed); // Update the active timer for current segment
            // The `trialConfig` total budget value itself is NOT changed here.
        } else if (editModalContext.type === 'fixed-remaining-edit') {
            // Case 3: Setting the *remaining* time for a fixed-duration segment (e.g., Opening, Closing)
            const segment = editModalContext.segment; // The current segment being edited
            const originalDuration = segment.duration; // Its originally configured total duration. Note: For rebuttal, this is already the calculated effective duration from displayRemainingTime.

            // The `newTimeInSecondsFromModal` is the desired *remaining* time.
            // So, the new calculated elapsed time for this segment is original_duration - desired_remaining.
            const newCalculatedElapsed = originalDuration - newTimeInSecondsFromModal;

            // Ensure the final elapsed time is within valid bounds (non-negative and not exceeding original duration)
            const finalElapsed = Math.max(0, Math.min(newCalculatedElapsed, originalDuration));

            setCurrentSegmentElapsed(finalElapsed); // Update the active timer display

            // Also update the actualElapsed in the trialSegments array for consistency in the summary
            setTrialSegments(prevSegments => {
                const newSegments = [...prevSegments];
                const segToUpdate = newSegments.find(s => s.id === segment.id);
                if (segToUpdate) {
                    segToUpdate.actualElapsed = finalElapsed;
                }
                return newSegments;
            });
        }

        closeEditModal();
    };

    /**
     * Returns a human-readable name for a budget key for display in the edit modal.
     * @param {string} key - The budget key (e.g., 'pOverallDirectDuration').
     * @returns {string} Readable budget name.
     */
    const getBudgetReadableName = (key) => {
        switch (key) {
            case 'pOverallDirectDuration': return 'P. Total Direct/Redirect Budget';
            case 'dOverallCrossDuration': return 'D. Total Cross/Recross (P. Wits) Budget';
            case 'dOverallDirectDuration': return 'D. Total Direct/Redirect Budget';
            case 'pOverallCrossDuration': return 'P. Total Cross/Recross (D. Wits) Budget';
            default: return key;
        }
    };

    /**
     * Returns an abbreviated name for a trial segment for display in the summary.
     * Memoized for performance.
     * @param {Object} segment - The trial segment object.
     * @returns {string} Abbreviated segment name.
     */
    const getAbbreviatedSegmentName = useCallback((segment) => {
        let name = segment.name;
        name = name.replace('Plaintiff', 'P.').replace('Defense', 'D.');
        name = name.replace(' Direct Examination', ' Direct');
        name = name.replace(' Cross Examination', ' Cross');
        name = name.replace(' Re-direct Examination', ' Redirect');
        name = name.replace(' Re-cross Examination', ' Recross');
        name = name.replace(' Statement', '');
        name = name.replace(' Argument', '');
        return name;
    }, []);

    /**
     * Navigates the timer to a specific segment from the summary list.
     * Pauses the timer and updates `currentSegmentIndex` and `currentSegmentElapsed`.
     * @param {number} segmentId - The unique ID of the segment to navigate to.
     */
    const goToSegmentFromSummary = useCallback((segmentId) => {
        setIsRunning(false); // Pause timer
        setShowSettings(false); // Ensure timer view is visible

        const segmentIndex = trialSegments.findIndex(seg => seg.id === segmentId);
        if (segmentIndex !== -1) {
            // Save the current segment's time before jumping
            saveCurrentSegmentTime();

            setCurrentSegmentIndex(segmentIndex);
            // Load the actual elapsed time of the segment clicked
            setCurrentSegmentElapsed(trialSegments[segmentIndex].actualElapsed);
        }
    }, [trialSegments, saveCurrentSegmentTime]);


    /**
     * Generates a PDF of the Trial Summary section.
     * Uses html2canvas to render the div to an image, then jsPDF to create the PDF.
     */
    const generatePdf = useCallback(async () => {
        if (!arePdfLibsLoaded) {
            console.warn("PDF libraries are not yet loaded. Please wait and try again.");
            return;
        }
        if (!trialSummaryRef.current) {
            console.error("Trial Summary element not found for PDF generation.");
            return;
        }
        // Directly use the global objects now that we are sure they are loaded
        const html2canvasInstance = window.html2canvas;
        const jsPDFInstance = window.jspdf.jsPDF;

        setIsGeneratingPdf(true); // Set loading state

        try {
            // Capture the content of the trial summary div
            const canvas = await html2canvasInstance(trialSummaryRef.current, { // Use html2canvasInstance
                scale: 2, // Increase scale for better resolution
                useCORS: true, // Enable CORS if you have external images (though not strictly needed here)
                logging: false, // Disable logging for cleaner console
            });

            // Create a new jsPDF instance
            // 'p' for portrait, 'mm' for millimeters, 'a4' for A4 size
            const pdf = new jsPDFInstance('p', 'mm', 'a4'); // Use jsPDFInstance
            const imgData = canvas.toDataURL('image/png'); // Get image data as PNG

            const imgWidth = 210; // A4 width in mm
            const pageHeight = 297; // A4 height in mm
            const imgHeight = canvas.height * imgWidth / canvas.width;
            let heightLeft = imgHeight;
            let position = 0;

            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            // Save the PDF
            pdf.save('Mock_Trial_Summary.pdf');
        } catch (error) {
            console.error("Error generating PDF:", error);
            // You could show a user-friendly error message here
        } finally {
            setIsGeneratingPdf(false); // Reset loading state
        }
    }, [arePdfLibsLoaded]); // Depend on arePdfLibsLoaded to enable the function correctly.


    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-200 flex items-center justify-center p-4 font-inter text-gray-900">
            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-2xl border border-gray-300">
                <h1 className="text-4xl font-extrabold text-center mb-8 text-indigo-800">
                    Mock Trial Timer
                </h1>

                {showSettings ? (
                    // Settings View
                    <div className="space-y-6">
                        <h2 className="text-2xl font-semibold text-gray-700 mb-6 text-center">Trial Configuration</h2>

                        {/* Mode Selection */}
                        <div className="flex justify-center mb-6 space-x-4">
                            <label className="inline-flex items-center cursor-pointer">
                                <input
                                    type="radio"
                                    className="form-radio text-blue-600 h-5 w-5 rounded-full accent-blue-600"
                                    name="configMode"
                                    value="simple"
                                    checked={configMode === 'simple'}
                                    onChange={() => setConfigMode('simple')}
                                />
                                <span className="ml-2 text-lg text-gray-700">Simple Mode</span>
                            </label>
                            <label className="inline-flex items-center cursor-pointer">
                                <input
                                    type="radio"
                                    className="form-radio text-blue-600 h-5 w-5 rounded-full accent-blue-600"
                                    name="configMode"
                                    value="advanced"
                                    checked={configMode === 'advanced'}
                                    onChange={() => setConfigMode('advanced')}
                                />
                                <span className="ml-2 text-lg text-gray-700">Advanced Mode</span>
                            </label>
                        </div>

                        {/* Witness Count Settings */}
                        <div className="bg-purple-50 p-5 rounded-xl shadow-sm border border-purple-200">
                            <h3 className="text-xl font-semibold text-purple-800 mb-3">Number of Witnesses</h3>
                            {configMode === 'simple' ? (
                                <div className="flex items-center space-x-2 justify-between">
                                    <label htmlFor="simple-witness-count" className="text-lg font-medium text-gray-700">Per Side:</label>
                                    <input
                                        id="simple-witness-count"
                                        type="number"
                                        min="0"
                                        value={trialConfig.plaintiffWitnessCount} // Use plaintiff as the source for simple mode
                                        onChange={(e) => handleWitnessCountChange('plaintiffWitnessCount', e.target.value)}
                                        className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                        aria-label="Number of Witnesses per Side"
                                    />
                                </div>
                            ) : (
                                <div className="flex flex-col sm:flex-row justify-between space-y-3 sm:space-y-0 sm:space-x-4">
                                    <div className="flex items-center space-x-2">
                                        <label htmlFor="plaintiff-witness-count" className="text-lg font-medium text-gray-700">Plaintiff:</label>
                                        <input
                                            id="plaintiff-witness-count"
                                            type="number"
                                            min="0"
                                            value={trialConfig.plaintiffWitnessCount}
                                            onChange={(e) => handleWitnessCountChange('plaintiffWitnessCount', e.target.value)}
                                            className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                            aria-label="Number of Plaintiff Witnesses"
                                        />
                                    </div>
                                    <div className="flex items-center space-x-2">
                                        <label htmlFor="defense-witness-count" className="text-lg font-medium text-gray-700">Defense:</label>
                                        <input
                                            id="defense-witness-count"
                                            type="number"
                                            min="0"
                                            value={trialConfig.defenseWitnessCount}
                                            onChange={(e) => handleWitnessCountChange('defenseWitnessCount', e.target.value)}
                                            className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                            aria-label="Number of Defense Witnesses"
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Phase Duration Settings */}
                        <div className="bg-blue-50 p-5 rounded-xl shadow-sm border border-blue-200">
                            <h3 className="text-xl font-semibold text-blue-800 mb-3">Phase Durations (Minutes)</h3>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {configMode === 'simple' ? (
                                    <>
                                        <div className="flex items-center justify-between">
                                            <label htmlFor="simple-opening-duration" className="text-lg font-medium text-gray-800">Opening:</label>
                                            <input
                                                id="simple-opening-duration"
                                                type="number"
                                                min="0"
                                                value={Math.floor(trialConfig.pOpeningDuration / 60)}
                                                onChange={(e) => handleDurationChange('pOpeningDuration', e.target.value)}
                                                className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                aria-label="Opening duration in minutes"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <label htmlFor="simple-directs-duration" className="text-lg font-medium text-gray-800">Directs:</label>
                                            <input
                                                id="simple-directs-duration"
                                                type="number"
                                                min="0"
                                                value={Math.floor(trialConfig.pOverallDirectDuration / 60)}
                                                onChange={(e) => handleDurationChange('pOverallDirectDuration', e.target.value)}
                                                className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                aria-label="Directs duration in minutes"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <label htmlFor="simple-crosses-duration" className="text-lg font-medium text-gray-800">Crosses:</label>
                                            <input
                                                id="simple-crosses-duration"
                                                type="number"
                                                min="0"
                                                value={Math.floor(trialConfig.dOverallCrossDuration / 60)}
                                                onChange={(e) => handleDurationChange('dOverallCrossDuration', e.target.value)}
                                                className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                aria-label="Crosses duration in minutes"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <label htmlFor="simple-closing-duration" className="text-lg font-medium text-gray-800">Closing:</label>
                                            <input
                                                id="simple-closing-duration"
                                                type="number"
                                                min="0"
                                                value={Math.floor(trialConfig.pClosingDuration / 60)}
                                                onChange={(e) => handleDurationChange('pClosingDuration', e.target.value)}
                                                className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                aria-label="Closing duration in minutes"
                                            />
                                        </div>
                                        <div className="flex items-center justify-between">
                                            <label htmlFor="simple-rebuttal-duration" className="text-lg font-medium text-gray-800">Max Rebuttal Time:</label>
                                            <input
                                                id="simple-rebuttal-duration"
                                                type="number"
                                                min="0"
                                                value={Math.floor(trialConfig.maxRebuttalDuration / 60)}
                                                onChange={(e) => handleDurationChange('maxRebuttalDuration', e.target.value)}
                                                className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                aria-label="Max Rebuttal duration in minutes"
                                            />
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {/* Fixed Durations */}
                                        {Object.entries({
                                            pOpeningDuration: 'P. Opening',
                                            dOpeningDuration: 'D. Opening',
                                            pClosingDuration: 'P. Closing',
                                            dClosingDuration: 'D. Closing',
                                            maxRebuttalDuration: 'Max Rebuttal Time',
                                        }).map(([key, name]) => (
                                            <div key={key} className="flex items-center justify-between">
                                                <label htmlFor={`${key}-duration`} className="text-lg font-medium text-gray-800">{name}:</label>
                                                <input
                                                    id={`${key}-duration`}
                                                    type="number"
                                                    min="0"
                                                    value={Math.floor(trialConfig[key] / 60)} // Display in minutes
                                                    onChange={(e) => handleDurationChange(key, e.target.value)}
                                                    className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                    aria-label={`${name} duration in minutes`}
                                                />
                                            </div>
                                        ))}
                                        {/* Overall Examination Budgets */}
                                        {Object.entries({
                                            pOverallDirectDuration: 'P. Directs',
                                            dOverallCrossDuration: 'D. Crosses (P. Wits)',
                                            dOverallDirectDuration: 'D. Directs',
                                            pOverallCrossDuration: 'P. Crosses (D. Wits)',
                                        }).map(([key, name]) => (
                                            <div key={key} className="flex items-center justify-between">
                                                <label htmlFor={`${key}-duration`} className="text-lg font-medium text-gray-800">{name}:</label>
                                                <input
                                                    id={`${key}-duration`}
                                                    type="number"
                                                    min="0"
                                                    value={Math.floor(trialConfig[key] / 60)} // Display in minutes
                                                    onChange={(e) => handleDurationChange(key, e.target.value)}
                                                    className="w-20 p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-center"
                                                    aria-label={`${name} duration in minutes`}
                                                />
                                            </div>
                                        ))}
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Show/Hide Total Side Times Toggle */}
                        <div className="bg-gray-50 p-5 rounded-xl shadow-sm border border-gray-200 flex items-center justify-between">
                            <label className="text-lg font-medium text-gray-700 flex items-center cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="form-checkbox h-5 w-5 text-blue-600 rounded accent-blue-600"
                                    checked={trialConfig.showTotalSideTimes}
                                    onChange={handleToggleShowTotalSideTimes}
                                />
                                <span className="ml-2">Show Total Side Times on Timer</span>
                            </label>
                        </div>

                        <button
                            onClick={startTrial}
                            className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-3 px-4 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-lg active:shadow-inner"
                        >
                            Start Trial
                        </button>
                    </div>
                ) : (
                    // Timer View
                    <div className="text-center space-y-6">
                        <div className="bg-purple-100 p-6 rounded-xl shadow-md border border-purple-300">
                            <h2 className="text-3xl font-semibold text-purple-800 mb-2">Current Phase:</h2>
                            <p className="text-5xl font-extrabold text-purple-900 drop-shadow-md">
                                {currentSegment ? currentSegment.name : 'Trial Not Started'}
                            </p>
                            {currentSegment && currentSegment.side && currentSegment.type !== 'end' && (
                                <p className={`text-2xl font-medium mt-1 ${currentSegment.side === 'plaintiff' ? 'text-green-700' : 'text-red-700'}`}>
                                    ({currentSegment.side.charAt(0).toUpperCase() + currentSegment.side.slice(1)} Side)
                                </p>
                            )}
                        </div>

                        {/* Total Elapsed Time for P and D (derived from useMemo) - Conditionally Rendered */}
                        {trialConfig.showTotalSideTimes && (
                            <div className="flex justify-around items-center bg-gray-50 p-4 rounded-xl shadow-md border border-gray-200 text-lg sm:text-xl font-semibold">
                                <div className="flex flex-col items-center">
                                    <span className="text-green-700">Plaintiff Total:</span>
                                    <span className="text-gray-900">{formatTime(derivedTotalPlaintiffElapsed)}</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <span className="text-red-700">Defense Total:</span>
                                    <span className="text-gray-900">{formatTime(derivedTotalDefenseElapsed)}</span>
                                </div>
                            </div>
                        )}

                        {/* Current Segment Timer Display - Only show if not 'end' segment */}
                        {currentSegment && currentSegment.type !== 'end' && (
                            <div className="flex justify-around items-center bg-yellow-50 p-6 rounded-xl shadow-md border border-yellow-200">
                                <div className="flex flex-col items-center">
                                    <p className="text-2xl font-medium text-gray-700">Time Elapsed <br /> (Current Segment):</p>
                                    <p className="text-6xl font-extrabold text-gray-900 mt-2">
                                        {formatTime(currentSegmentElapsed)}
                                    </p>
                                    {/* Edit button for current segment elapsed time */}
                                    {currentSegment && currentSegment.type !== 'end' && (
                                        <button
                                            onClick={() => openEditModal({ type: 'segment', segment: currentSegment })}
                                            className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-semibold flex items-center transition duration-150 ease-in-out hover:underline"
                                            title="Edit current segment time"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                            </svg>
                                            Edit Current Time
                                        </button>
                                    )}
                                </div>
                                <div className="w-px h-24 bg-gray-300 mx-8 hidden sm:block"></div> {/* Separator */}
                                <div className="flex flex-col items-center">
                                    <p className="text-2xl font-medium text-gray-700">
                                        {displayRemainingTime.type === 'fixed' ? 'Time Remaining:' : 'Time Remaining:'}
                                    </p>
                                    <p className={`text-6xl font-extrabold mt-2 ${
                                        (displayRemainingTime.value <= 60 && displayRemainingTime.value > 0)
                                        ? 'text-red-600 animate-pulse'
                                        : (displayRemainingTime.value === 0 && displayRemainingTime.overtime === 0)
                                        ? 'text-red-600' // Always red when 0 and no overtime
                                        : 'text-blue-600' // Default to blue
                                    }`}>
                                        {displayRemainingTime.value === 0 && (displayRemainingTime.type === 'budget' || displayRemainingTime.type === 'fixed')
                                            ? 'STOP'
                                            : formatTime(displayRemainingTime.value)}
                                    </p>
                                    {/* Display Overtime if applicable */}
                                    {displayRemainingTime.overtime > 0 && (
                                        <p className="text-xl font-bold text-red-600 mt-2">
                                            Overtime: +{formatTime(displayRemainingTime.overtime)}
                                        </p>
                                    )}
                                    {/* Edit button for budget remaining time IF it's an examination phase */}
                                    {displayRemainingTime.type === 'budget' && currentSegment && currentSegment.type !== 'end' && (
                                        <button
                                            onClick={() => openEditModal({ type: 'budget', budgetKey: displayRemainingTime.budgetKey, usedBeforeCurrentSegment: displayRemainingTime.usedBeforeCurrentSegment, currentTotalBudget: displayRemainingTime.totalBudget })}
                                            className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-semibold flex items-center transition duration-150 ease-in-out hover:underline"
                                            title="Edit total budget time"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                            </svg>
                                            Edit Remaining
                                        </button>
                                    )}
                                    {/* Edit button for fixed time remaining */}
                                    {displayRemainingTime.type === 'fixed' && currentSegment && currentSegment.type !== 'end' && (
                                         <button
                                            onClick={() => openEditModal({ type: 'fixed-remaining-edit', segment: currentSegment, originalDuration: displayRemainingTime.totalBudget })}
                                            className="mt-2 text-blue-600 hover:text-blue-800 text-sm font-semibold flex items-center transition duration-150 ease-in-out hover:underline"
                                            title="Edit remaining time"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                            </svg>
                                            Edit Remaining
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Control Buttons */}
                        {/* Control buttons are always visible unless a general purpose modal (edit or confirm) or a redirect/recross prompt is open */}
                        {!(showEditModal || showConfirmResetCurrent || showConfirmFullReset || showRedirectPrompt || showRecrossPrompt) && currentSegment && currentSegment.type !== 'end' && (
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-6">
                                {/* Start/Pause */}
                                <button
                                    onClick={toggleTimer}
                                    className={`py-3 px-4 rounded-xl text-white font-bold transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner
                                        ${isRunning ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}
                                >
                                    {isRunning ? (
                                        <span className="flex items-center justify-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Pause
                                        </span>
                                    ) : (
                                        <span className="flex items-center justify-center">
                                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197 2.132A1 1 0 0110 13.82V9.18a1 1 0 011.555-.832l3.197 2.132a1 1 0 010 1.664z" />
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                            </svg>
                                            Start
                                        </span>
                                    )}
                                </button>
                                {/* Previous */}
                                <button
                                    onClick={moveToPreviousSegment}
                                    disabled={currentSegmentIndex === 0}
                                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                                    </svg>
                                    Previous
                                </button>
                                {/* Next */}
                                <button
                                    onClick={() => moveToNextSegment()}
                                    disabled={currentSegmentIndex >= trialSegments.length - 1} // Disable if at the very end
                                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Next
                                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                                    </svg>
                                </button>
                                {/* Reset Current */}
                                <button
                                    onClick={requestResetCurrentPhase}
                                    className="bg-orange-500 hover:bg-orange-600 text-white font-bold py-3 px-4 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner flex items-center justify-center"
                                >
                                    <RotateCcw className="h-6 w-6 mr-2" />
                                    Reset Current
                                </button>
                                {/* Full Reset */}
                                <button
                                    onClick={requestFullReset}
                                    className="bg-gray-700 hover:bg-gray-800 text-white font-bold py-3 px-4 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner flex items-center justify-center col-span-2 sm:col-span-1"
                                >
                                    <RefreshCcw className="h-6 w-6 mr-2" />
                                    Full Reset
                                </button>
                            </div>
                        )}

                        {/* Redirect Prompt */}
                        {showRedirectPrompt && currentSegment && (
                            <div className="fixed inset-0 bg-gray-600 bg-opacity-70 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
                                <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm mx-auto border-2 border-indigo-400 text-center animate-fade-in-up">
                                    <h3 className="text-xl font-semibold text-indigo-800 mb-6">
                                        {`P Witness ${currentSegment.witnessIndex + 1} - Cross finished. Is there a Redirect?`}
                                    </h3>
                                    <div className="flex justify-center space-x-4">
                                        <button
                                            onClick={() => handleRedirectDecisionPrompt(true)}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                                        >
                                            Yes
                                        </button>
                                        <button
                                            onClick={() => handleRedirectDecisionPrompt(false)}
                                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                                        >
                                            No
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Recross Prompt */}
                        {showRecrossPrompt && currentSegment && (
                            <div className="fixed inset-0 bg-gray-600 bg-opacity-70 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
                                <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm mx-auto border-2 border-indigo-400 text-center animate-fade-in-up">
                                    <h3 className="text-xl font-semibold text-indigo-800 mb-6">
                                        {`P Witness ${currentSegment.witnessIndex + 1} - Redirect finished. Is there a Recross?`}
                                    </h3>
                                    <div className="flex justify-center space-x-4">
                                        <button
                                            onClick={() => handleRecrossDecisionPrompt(true)}
                                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                                        >
                                            Yes
                                        </button>
                                        <button
                                            onClick={() => handleRecrossDecisionPrompt(false)}
                                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md"
                                        >
                                            No
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Trial Ended Message */}
                        {currentSegment && currentSegment.type === 'end' && (
                            <div className="bg-green-100 p-6 rounded-xl shadow-md border border-green-300 mt-6 mb-6">
                                <h3 className="text-3xl font-bold text-green-800">Trial Ended!</h3>
                                <p className="text-xl text-gray-700 mt-2 mb-4">All phases completed.</p>
                                {/* New button to go back to settings */}
                                <button
                                    onClick={requestFullReset} // This function already handles resetting and showing settings
                                    className="mt-4 w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner"
                                >
                                    Return to Settings / Start New Trial
                                </button>
                            </div>
                        )}

                        {/* Trial Summary - Always Visible */}
                        <div ref={trialSummaryRef} className="bg-white p-4 rounded-xl shadow-inner border border-gray-200 text-left mt-6">
                            <div className="flex justify-between items-center mb-3 border-b-2 border-gray-200 pb-2">
                                <h4 className="text-2xl font-semibold text-gray-800 ">Trial Summary</h4>
                                <button
                                    onClick={generatePdf}
                                    // Disable the button until the PDF libraries are loaded
                                    disabled={isGeneratingPdf || !arePdfLibsLoaded}
                                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-md active:shadow-inner flex items-center justify-center text-sm"
                                >
                                    {isGeneratingPdf ? (
                                        <span className="flex items-center">
                                            <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                            </svg>
                                            Generating...
                                        </span>
                                    ) : (
                                        <span className="flex items-center">
                                            <FileText className="h-5 w-5 mr-1" />
                                            Generate PDF
                                        </span>
                                    )}
                                </button>
                            </div>

                            <div className="flex flex-col sm:flex-row justify-between space-y-4 sm:space-y-0 sm:space-x-4">
                                {/* Plaintiff Column */}
                                <div className="w-full sm:w-1/2">
                                    <h5 className="text-xl font-semibold text-green-700 mb-2">Plaintiff Times</h5>
                                    {/* Removed max-h-60 and overflow-y-auto */}
                                    <ul className="space-y-1 pr-2 custom-scrollbar">
                                        {trialSegments.filter(s =>
                                            s.actualElapsed > 0 && s.type !== 'end' && (
                                                (s.side === 'plaintiff' && (s.type === 'opening' || s.type === 'closing' || s.type === 'rebuttal' || s.type === 'direct' || s.type === 'redirect')) ||
                                                (s.side === 'plaintiff' && (s.type === 'cross' || s.type === 'recross') && s.name.includes('D Witness'))
                                            )
                                        ).map((segment) => (
                                            <li key={segment.id} className="flex justify-between items-center text-md text-gray-700 py-1 hover:bg-gray-50 rounded-md px-2">
                                                <button
                                                    onClick={() => goToSegmentFromSummary(segment.id)}
                                                    className="flex-grow text-left focus:outline-none hover:text-blue-700 transition duration-150 ease-in-out"
                                                    title={`Go to ${getAbbreviatedSegmentName(segment)}`}
                                                >
                                                    <span>{getAbbreviatedSegmentName(segment)}:</span>
                                                    <span className="font-mono text-gray-900 ml-2 font-bold">{formatTime(segment.actualElapsed)}</span>
                                                </button>
                                                {segment.id !== currentSegment?.id && (
                                                    <button
                                                        onClick={() => openEditModal({ type: 'segment', segment: segment })}
                                                        className="text-blue-500 hover:text-blue-700 text-sm focus:outline-none flex-shrink-0 ml-2"
                                                        title="Edit time"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>

                                {/* Defense Column */}
                                <div className="w-full sm:w-1/2">
                                    <h5 className="text-xl font-semibold text-red-700 mb-2">Defense Times</h5>
                                    {/* Removed max-h-60 and overflow-y-auto */}
                                    <ul className="space-y-1 pr-2 custom-scrollbar">
                                        {trialSegments.filter(s =>
                                            s.actualElapsed > 0 && s.type !== 'end' && (
                                                (s.side === 'defense' && (s.type === 'opening' || s.type === 'closing' || s.type === 'direct' || s.type === 'redirect')) ||
                                                (s.side === 'defense' && (s.type === 'cross' || s.type === 'recross') && s.name.includes('P Witness'))
                                            )
                                        ).map((segment) => (
                                            <li key={segment.id} className="flex justify-between items-center text-md text-gray-700 py-1 hover:bg-gray-50 rounded-md px-2">
                                                <button
                                                    onClick={() => goToSegmentFromSummary(segment.id)}
                                                    className="flex-grow text-left focus:outline-none hover:text-blue-700 transition duration-150 ease-in-out"
                                                    title={`Go to ${getAbbreviatedSegmentName(segment)}`}
                                                >
                                                    <span>{getAbbreviatedSegmentName(segment)}:</span>
                                                    <span className="font-mono text-gray-900 ml-2 font-bold">{formatTime(segment.actualElapsed)}</span>
                                                </button>
                                                {segment.id !== currentSegment?.id && (
                                                    <button
                                                        onClick={() => openEditModal({ type: 'segment', segment: segment })}
                                                        className="text-blue-500 hover:text-blue-700 text-sm focus:outline-none flex-shrink-0 ml-2"
                                                        title="Edit time"
                                                    >
                                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                                            <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                                                        </svg>
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>

                            <div className="mt-4 pt-4 border-t-2 border-gray-200">
                                <h4 className="text-xl font-semibold text-gray-800 mb-2">Overall Usage:</h4>
                                <div className="flex flex-col sm:flex-row justify-between space-y-4 sm:space-y-0 sm:space-x-4">
                                    {/* Plaintiff Overall Exam Usage Column */}
                                    <div className="w-full sm:w-1/2">
                                        <h5 className="text-lg font-semibold text-green-700 mb-2">Plaintiff</h5>
                                        <div className="space-y-1 text-base">
                                            <div className="flex justify-between text-green-700">
                                                <span>Opening:</span>
                                                <span className="font-bold">{formatTime(pOpeningUsed)} / {formatTime(trialConfig.pOpeningDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-green-700">
                                                <span>Directs:</span>
                                                <span className="font-bold">{formatTime(pDirectUsed)} / {formatTime(trialConfig.pOverallDirectDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-green-700">
                                                <span>Crosses:</span>
                                                <span className="font-bold">{formatTime(pCrossUsed)} / {formatTime(trialConfig.pOverallCrossDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-green-700">
                                                <span>Closing:</span>
                                                <span className="font-bold">{formatTime(pClosingUsed)} / {formatTime(trialConfig.pClosingDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-green-700">
                                                <span>Rebuttal:</span>
                                                <span className="font-bold">{formatTime(pRebuttalUsed)} / {formatTime(trialConfig.maxRebuttalDuration)}</span>
                                            </div>
                                        </div>
                                    </div>
                                    {/* Defense Overall Exam Usage Column */}
                                    <div className="w-full sm:w-1/2">
                                        <h5 className="text-lg font-semibold text-red-700 mb-2">Defense</h5>
                                        <div className="space-y-1 text-base">
                                            <div className="flex justify-between text-red-700">
                                                <span>Opening:</span>
                                                <span className="font-bold">{formatTime(dOpeningUsed)} / {formatTime(trialConfig.dOpeningDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-red-700">
                                                <span>Directs:</span>
                                                <span className="font-bold">{formatTime(dDirectUsed)} / {formatTime(trialConfig.dOverallDirectDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-red-700">
                                                <span>Crosses:</span>
                                                <span className="font-bold">{formatTime(dCrossUsed)} / {formatTime(trialConfig.dOverallCrossDuration)}</span>
                                            </div>
                                            <div className="flex justify-between text-red-700">
                                                <span>Closing:</span>
                                                <span className="font-bold">{formatTime(dClosingUsed)} / {formatTime(trialConfig.dClosingDuration)}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Edit Time Modal */}
                {showEditModal && editModalContext && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-70 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
                        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-md mx-auto border-2 border-gray-300 animate-fade-in-up">
                            <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">
                                {editModalContext.type === 'segment'
                                    ? `Edit Time for "${getAbbreviatedSegmentName(editModalContext.segment)}"`
                                    : editModalContext.type === 'budget'
                                        ? `Set Remaining Budget for "${getBudgetReadableName(editModalContext.budgetKey)}"`
                                        : `Set Remaining Time for "${getAbbreviatedSegmentName(editModalContext.segment)}"`
                                }
                            </h3>
                            <div className="flex items-center justify-center space-x-4 mb-6">
                                <input
                                    type="number"
                                    min="0"
                                    value={editTimeMinutes}
                                    onChange={(e) => setEditTimeMinutes(Math.max(0, parseInt(e.target.value, 10) || 0))}
                                    className="w-24 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-center text-xl font-mono"
                                    aria-label="Minutes"
                                />
                                <span className="text-3xl font-bold text-gray-600">:</span>
                                <input
                                    type="number"
                                    min="0"
                                    max="59"
                                    value={editTimeSeconds}
                                    onChange={(e) => setEditTimeSeconds(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                                    className="w-24 p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 text-center text-xl font-mono"
                                    aria-label="Seconds"
                                />
                            </div>
                            <div className="flex justify-center space-x-4">
                                <button
                                    onClick={handleEditTimeSave}
                                    className="bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-lg active:shadow-inner"
                                >
                                    Save Changes
                                </button>
                                <button
                                    onClick={closeEditModal}
                                    className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-6 rounded-xl transition duration-300 ease-in-out transform hover:scale-105 shadow-lg active:shadow-inner"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirm Reset Current Modal */}
                {showConfirmResetCurrent && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-70 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
                        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm mx-auto border-2 border-gray-300 text-center animate-fade-in-up">
                            <h3 className="text-xl font-bold text-gray-800 mb-4">Are you sure you want to reset the current phase?</h3>
                            <p className="text-gray-600 mb-6">This will set the current phase's timer back to 0.</p>
                            <div className="flex justify-center space-x-4">
                                <button
                                    onClick={confirmResetCurrentPhase}
                                    className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-5 rounded-xl transition duration-300 ease-in-out transform hover:scale-105"
                                >
                                    Yes, Reset
                                </button>
                                <button
                                    onClick={() => setShowConfirmResetCurrent(false)}
                                    className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-5 rounded-xl transition duration-300 ease-in-out transform hover:scale-105"
                                >
                                    No, Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Confirm Full Reset Modal */}
                {showConfirmFullReset && (
                    <div className="fixed inset-0 bg-gray-600 bg-opacity-70 overflow-y-auto h-full w-full flex items-center justify-center z-50 p-4">
                        <div className="bg-white p-8 rounded-xl shadow-2xl w-full max-w-sm mx-auto border-2 border-gray-300 text-center animate-fade-in-up">
                            <h3 className="text-xl font-bold text-gray-800 mb-4">Are you sure you want to perform a full trial reset?</h3>
                            <p className="text-gray-600 mb-6">This will clear all times and return to the configuration screen.</p>
                            <div className="flex justify-center space-x-4">
                                <button
                                    onClick={confirmFullReset}
                                    className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-5 rounded-xl transition duration-300 ease-in-out transform hover:scale-105"
                                >
                                    Yes, Full Reset
                                </button>
                                <button
                                    onClick={() => setShowConfirmFullReset(false)}
                                    className="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-5 rounded-xl transition duration-300 ease-in-out transform hover:scale-105"
                                >
                                    No, Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
