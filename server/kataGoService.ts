import { spawn, ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';
import { LiveGameSession, AnalysisResult, Player, Point, RecommendedMove } from '../types/index.js';
import * as types from '../types/index.js';
import { fileURLToPath } from 'url';
import https from 'https';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 프로젝트 루트 기준으로 경로 설정 (process.cwd() 사용)
const PROJECT_ROOT = process.cwd();

// 환경 변수로 KataGo 경로 설정 가능
const KATAGO_PATH = process.env.KATAGO_PATH || path.resolve(PROJECT_ROOT, 'katago/katago.exe');
const MODEL_PATH = process.env.KATAGO_MODEL_PATH || path.resolve(PROJECT_ROOT, 'katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz');
const CONFIG_PATH = path.resolve(__dirname, './temp_katago_config.cfg');
const KATAGO_HOME_PATH = process.env.KATAGO_HOME_PATH || path.resolve(__dirname, './katago_home');

// KataGo 설정 - 환경 변수로 조정 가능
const KATAGO_NUM_ANALYSIS_THREADS = parseInt(process.env.KATAGO_NUM_ANALYSIS_THREADS || '4', 10);
const KATAGO_NUM_SEARCH_THREADS = parseInt(process.env.KATAGO_NUM_SEARCH_THREADS || '8', 10);
const KATAGO_MAX_VISITS = parseInt(process.env.KATAGO_MAX_VISITS || '1000', 10);
const KATAGO_NN_MAX_BATCH_SIZE = parseInt(process.env.KATAGO_NN_MAX_BATCH_SIZE || '16', 10);

// 배포 환경에서 KataGo HTTP API URL (환경 변수로 설정 가능)
const KATAGO_API_URL = process.env.KATAGO_API_URL;
const USE_HTTP_API = !!KATAGO_API_URL; // API URL이 설정되어 있으면 HTTP API 사용
const IS_LOCAL = process.env.NODE_ENV !== 'production'; // 로컬 환경 확인

const LETTERS = "ABCDEFGHJKLMNOPQRST";

const pointToKataGoMove = (p: Point, boardSize: number): string => {
    if (p.x === -1 || p.y === -1) {
        return 'pass';
    }
    if (p.x >= 0 && p.x < LETTERS.length) {
        return `${LETTERS[p.x]}${boardSize - p.y}`;
    }
    return 'pass';
};

const kataGoMoveToPoint = (move: string, boardSize: number): Point => {
    if (move.toLowerCase() === 'pass') {
        return { x: -1, y: -1 };
    }
    const letter = move.charAt(0).toUpperCase();
    const x = LETTERS.indexOf(letter);
    const y = boardSize - parseInt(move.substring(1), 10);

    // Safeguard against malformed move strings from KataGo that could result in y being NaN.
    if (isNaN(y)) {
        console.error(`[KataGo Service] Failed to parse move string: "${move}". It might be an unexpected format. Treating as a pass.`);
        return { x: -1, y: -1 };
    }
    return { x, y };
};

const kataGoResponseToAnalysisResult = (session: LiveGameSession, response: any, isWhitesTurn: boolean): AnalysisResult => {
    const { boardSize } = session.settings;
    const { rootInfo = {}, moveInfos = [], ownership = null } = response;

    const ownershipMap: number[][] = Array(boardSize).fill(0).map(() => Array(boardSize).fill(0));
    const deadStones: Point[] = [];
    
    let blackTerritory = 0;
    let whiteTerritory = 0;

    if (ownership && Array.isArray(ownership) && ownership.length > 0) {
        const ownershipBoardSize = Math.sqrt(ownership.length);

        // Check if the returned ownership map is a perfect square and large enough.
        // This handles cases where KataGo might incorrectly return a 19x19 map for a smaller board.
        if (Number.isInteger(ownershipBoardSize) && ownershipBoardSize >= boardSize) {
            const TERRITORY_THRESHOLD = 0.75;
            const DEAD_STONE_THRESHOLD = 0.75;
            for (let y = 0; y < boardSize; y++) {
                for (let x = 0; x < boardSize; x++) {
                    // Index into the (potentially larger) ownership grid from KataGo
                    const index = y * ownershipBoardSize + x;
                    
                    let ownerProbRaw = ownership[index];
                    let ownerProb = (typeof ownerProbRaw === 'number' && isFinite(ownerProbRaw)) ? ownerProbRaw : 0;
                    
                    // KataGo's ownership is from the current player's perspective.
                    // Positive for current player, negative for opponent.
                    // We want to standardize to Black's perspective (positive for black, negative for white).
                    if (isWhitesTurn) {
                        ownerProb *= -1;
                    }

                    ownershipMap[y][x] = Math.round(ownerProb * 10);
                    
                    const stoneOnBoard = session.boardState[y][x];

                    // Score empty points based on ownership probability
                    if (stoneOnBoard === Player.None) {
                        if (ownerProb > TERRITORY_THRESHOLD) {
                            blackTerritory += 1;
                        } else if (ownerProb < -TERRITORY_THRESHOLD) {
                            whiteTerritory += 1;
                        }
                    }
                    
                    // Identify dead stones for capture count and visualization, based on high ownership certainty
                    if (stoneOnBoard !== Player.None) {
                         if ((stoneOnBoard === Player.Black && ownerProb < -DEAD_STONE_THRESHOLD) || (stoneOnBoard === Player.White && ownerProb > DEAD_STONE_THRESHOLD)) {
                            deadStones.push({ x, y });
                        }
                    }
                }
            }
        }
    }
    
    const blackDeadCount = deadStones.filter(s => session.boardState[s.y][s.x] === Player.Black).length;
    const whiteDeadCount = deadStones.filter(s => session.boardState[s.y][s.x] === Player.White).length;

    const blackLiveCaptures = session.captures[Player.Black] || 0;
    const whiteLiveCaptures = session.captures[Player.White] || 0;

    const komi = session.finalKomi ?? session.settings.komi;

    // Korean/Territory scoring: Territory (empty points) + Captured stones (live + dead).
    const scoreDetails = {
        black: { 
            territory: Math.round(blackTerritory), 
            captures: blackLiveCaptures, // "captures" now means live captures
            liveCaptures: blackLiveCaptures, 
            deadStones: whiteDeadCount, 
            baseStoneBonus: 0, hiddenStoneBonus: 0, timeBonus: 0, itemBonus: 0, 
            total: Math.round(blackTerritory) + blackLiveCaptures + whiteDeadCount 
        },
        white: { 
            territory: Math.round(whiteTerritory), 
            captures: whiteLiveCaptures, // "captures" now means live captures
            liveCaptures: whiteLiveCaptures, 
            deadStones: blackDeadCount, 
            komi, baseStoneBonus: 0, hiddenStoneBonus: 0, timeBonus: 0, itemBonus: 0, 
            total: Math.round(whiteTerritory) + whiteLiveCaptures + blackDeadCount + komi
        },
    };
    
    const recommendedMoves: RecommendedMove[] = (moveInfos || [])
        .slice(0, 3)
        .map((info: any, i: number) => {
            const winrate = info.winrate || 0;
            const scoreLead = info.scoreLead || 0;
            return {
                ...kataGoMoveToPoint(info.move, boardSize),
                winrate: (isWhitesTurn ? (1 - winrate) : winrate) * 100,
                scoreLead: isWhitesTurn ? -scoreLead : scoreLead,
                order: i + 1,
            };
        });
    
    const winrateNum = Number(rootInfo.winrate);
    const scoreLeadNum = Number(rootInfo.scoreLead);
    
    const winRateBlack = isFinite(winrateNum) ? (isWhitesTurn ? (1 - winrateNum) * 100 : winrateNum * 100) : 50;
    const finalScoreLead = isFinite(scoreLeadNum) ? (isWhitesTurn ? -scoreLeadNum : scoreLeadNum) : 0;
    
    let winRateChange = 0;
    const prevAnalysis = session.previousAnalysisResult?.[session.player1.id] ?? session.previousAnalysisResult?.[session.player2.id];
    if (prevAnalysis) {
        const prevWinrateFloat = prevAnalysis.winRateBlack / 100;
        if (isFinite(prevWinrateFloat)) {
            winRateChange = (winRateBlack / 100 - prevWinrateFloat) * 100;
        }
    }
    
    return {
        winRateBlack,
        winRateChange: winRateChange,
        scoreLead: finalScoreLead,
        deadStones,
        ownershipMap: (ownership && ownership.length > 0) ? ownershipMap : null,
        recommendedMoves,
        areaScore: { black: scoreDetails.black.total, white: scoreDetails.white.total },
        scoreDetails,
        blackConfirmed: [], whiteConfirmed: [], blackRight: [], whiteRight: [], blackLikely: [], whiteLikely: [],
    };
};

class KataGoManager {
    private process: ChildProcess | null = null;
    private pendingQueries = new Map<string, { resolve: (value: any) => void, reject: (reason?: any) => void, timeout: any }>();
    private stdoutBuffer = '';
    private isStarting = false;
    private readyPromise: Promise<void> | null = null;

    constructor() {
        // Eager start removed. Will be started lazily on first query.
    }

    // 서버 시작 시 미리 초기화할 수 있도록 public 메서드로 변경
    public async ensureStarted(): Promise<void> {
        if (!this.process && !this.isStarting && !this.readyPromise) {
            try {
                await this.start();
            } catch (error: any) {
                // 초기화 실패는 로그만 남기고 계속 진행 (KataGo 없이도 서버는 동작 가능)
                console.error('[KataGo] Failed to start engine during initialization:', error.message);
            }
        } else if (this.readyPromise) {
            // 이미 시작 중이면 대기
            try {
                await this.readyPromise;
            } catch (error: any) {
                console.error('[KataGo] Engine initialization promise rejected:', error.message);
            }
        }
    }

    private start(): Promise<void> {
        if (this.readyPromise) {
            return this.readyPromise;
        }

        this.isStarting = true;
        this.readyPromise = new Promise<void>((resolve, reject) => {

            // 여러 경로 시도 (환경 변수 > 프로젝트 루트 katago 폴더 > 대체 경로들)
            let actualKataGoPath = KATAGO_PATH;
            let actualModelPath = MODEL_PATH;
            
            // 프로젝트 루트의 katago 폴더 경로 (Windows와 Linux 모두 지원)
            const projectKatagoPathWin = path.resolve(PROJECT_ROOT, 'katago/katago.exe');
            const projectKatagoPathLinux = path.resolve(PROJECT_ROOT, 'katago/katago');
            const projectModelPath = path.resolve(PROJECT_ROOT, 'katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz');
            
            const pathsToTry = [
                // 1. 환경 변수로 명시적으로 설정된 경로 (최우선)
                ...(process.env.KATAGO_PATH ? [KATAGO_PATH] : []),
                // 2. 프로젝트 루트의 katago 폴더 (Linux - 확장자 없음)
                projectKatagoPathLinux,
                // 3. 프로젝트 루트의 katago 폴더 (Windows - .exe 확장자)
                projectKatagoPathWin,
                // 4. 기타 대체 경로들 (Linux 먼저 시도)
                path.resolve(__dirname, '../katago/katago'),
                path.resolve(__dirname, '../katago/katago.exe'),
                path.resolve(__dirname, '../../katago/katago'),
                path.resolve(__dirname, '../../katago/katago.exe'),
                'C:\\katago\\katago.exe',
                'D:\\katago\\katago.exe',
            ];
            
            const modelPathsToTry = [
                // 1. 환경 변수로 명시적으로 설정된 경로 (최우선)
                ...(process.env.KATAGO_MODEL_PATH ? [MODEL_PATH] : []),
                // 2. 프로젝트 루트의 katago 폴더 (가장 일반적인 위치)
                projectModelPath,
                // 3. 기타 대체 경로들
                path.resolve(__dirname, '../katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz'),
                path.resolve(__dirname, '../../katago/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz'),
            ];
            
            // KataGo 실행 파일 찾기
            let foundKataGo = false;
            for (const tryPath of pathsToTry) {
                if (fs.existsSync(tryPath)) {
                    actualKataGoPath = tryPath;
                    console.log(`[KataGo] Engine found at: ${actualKataGoPath}`);
                    foundKataGo = true;
                    break;
                }
            }
            
            if (!foundKataGo) {
                const errorMsg = `[KataGo] Engine not found. Tried paths:\n${pathsToTry.map(p => `  - ${p}`).join('\n')}\n\nPlease set KATAGO_PATH environment variable or place katago.exe in one of the expected locations.`;
                console.error(errorMsg);
                this.isStarting = false;
                this.readyPromise = null;
                return reject(new Error(errorMsg));
            }
            
            // 모델 파일 찾기
            let foundModel = false;
            for (const tryPath of modelPathsToTry) {
                if (fs.existsSync(tryPath)) {
                    actualModelPath = tryPath;
                    foundModel = true;
                    break;
                }
            }
            
            // 모델 파일이 없으면 런타임에 다운로드 시도
            if (!foundModel) {
                console.log('[KataGo] Model file not found locally, attempting to download...');
                const modelUrl = 'https://media.katagotraining.org/uploaded/models/kata1-b28c512nbt-s9853922560-d5031756885.bin.gz';
                const modelDir = path.resolve(PROJECT_ROOT, 'katago');
                const modelPath = path.resolve(modelDir, 'kata1-b28c512nbt-s9853922560-d5031756885.bin.gz');
                
                // 모델 디렉토리 생성
                if (!fs.existsSync(modelDir)) {
                    fs.mkdirSync(modelDir, { recursive: true });
                }
                
                // 모델 파일 다운로드 (Promise 내부에서 동기적으로 import 사용)
                import('https').then((https) => {
                    console.log(`[KataGo] Downloading model from ${modelUrl}...`);
                    const writeStream = fs.createWriteStream(modelPath);
                    
                    https.get(modelUrl, (response) => {
                        if (response.statusCode !== 200) {
                            writeStream.close();
                            fs.unlinkSync(modelPath); // 실패한 파일 삭제
                            const errorMsg = `[KataGo] Model file not found and download failed. Tried paths:\n${modelPathsToTry.map(p => `  - ${p}`).join('\n')}\n\nDownload error: HTTP ${response.statusCode}\n\nPlease set KATAGO_MODEL_PATH environment variable or place the model file in one of the expected locations.`;
                            console.error(errorMsg);
                            this.isStarting = false;
                            this.readyPromise = null;
                            reject(new Error(errorMsg));
                            return;
                        }
                        response.pipe(writeStream);
                        writeStream.on('finish', () => {
                            writeStream.close();
                            actualModelPath = modelPath;
                            foundModel = true;
                            console.log('[KataGo] Model downloaded successfully');
                            // 다운로드 완료 후 KataGo 시작 계속
                            this.continueKataGoStart(actualKataGoPath, actualModelPath, resolve, reject);
                        });
                    }).on('error', (err) => {
                        writeStream.close();
                        if (fs.existsSync(modelPath)) {
                            fs.unlinkSync(modelPath);
                        }
                        const errorMsg = `[KataGo] Model file not found and download failed. Tried paths:\n${modelPathsToTry.map(p => `  - ${p}`).join('\n')}\n\nDownload error: ${err.message}\n\nPlease set KATAGO_MODEL_PATH environment variable or place the model file in one of the expected locations.`;
                        console.error(errorMsg);
                        this.isStarting = false;
                        this.readyPromise = null;
                        reject(new Error(errorMsg));
                    });
                }).catch((importError: any) => {
                    const errorMsg = `[KataGo] Failed to import https module: ${importError.message}`;
                    console.error(errorMsg);
                    this.isStarting = false;
                    this.readyPromise = null;
                    reject(new Error(errorMsg));
                });
                return; // 다운로드가 완료될 때까지 대기
            }
            
            // 모델 파일을 찾았거나 다운로드 완료 후 KataGo 시작
            this.continueKataGoStart(actualKataGoPath, actualModelPath, resolve, reject);
        });
        
        return this.readyPromise;
    }

    private continueKataGoStart(actualKataGoPath: string, actualModelPath: string, resolve: () => void, reject: (error: Error) => void) {
            
            try {
                if (!fs.existsSync(KATAGO_HOME_PATH)) {
                    fs.mkdirSync(KATAGO_HOME_PATH, { recursive: true });
                }
            } catch (e: any) {
                const errorMsg = `[KataGo] Failed to create home directory at ${KATAGO_HOME_PATH}: ${e.message}`;
                console.error(errorMsg);
                this.isStarting = false;
                this.readyPromise = null;
                return reject(new Error(errorMsg));
            }

            const configContent = `
logFile = ./katago_analysis_log.txt
homeDataDir = ${KATAGO_HOME_PATH.replace(/\\/g, '/')}
nnMaxBatchSize = ${KATAGO_NN_MAX_BATCH_SIZE}
analysisPVLen = 10
numAnalysisThreads = ${KATAGO_NUM_ANALYSIS_THREADS}
numSearchThreads = ${KATAGO_NUM_SEARCH_THREADS}
maxVisits = ${KATAGO_MAX_VISITS}
            `.trim();

            try {
                fs.writeFileSync(CONFIG_PATH, configContent);
            } catch (e: any) {
                const errorMsg = `[KataGo] Failed to write temporary config file: ${e.message}`;
                console.error(errorMsg);
                this.isStarting = false;
                this.readyPromise = null;
                return reject(new Error(errorMsg));
            }

            try {
                this.process = spawn(actualKataGoPath, [
                    'analysis', 
                    '-model', actualModelPath, 
                    '-config', CONFIG_PATH,
                ], {
                    cwd: KATAGO_HOME_PATH
                });
            } catch (e: any) {
                const errorMsg = `[KataGo] Failed to spawn process: ${e.message}`;
                console.error(errorMsg);
                this.isStarting = false;
                this.readyPromise = null;
                return reject(new Error(errorMsg));
            }

            this.process.on('spawn', () => {
                // KataGo가 실제로 준비될 때까지 약간의 대기 시간 필요
                setTimeout(() => {
                    this.isStarting = false;
                    resolve();
                }, 2000); // 2초 대기
            });

            this.process.stdout?.on('data', (data) => {
                this.processStdoutData(data);
            });
            this.process.stderr?.on('data', (data) => {
                const stderrText = data.toString();
                // 중요하지 않은 메시지 필터링
                if (!stderrText.includes('INFO:') && !stderrText.includes('WARNING:')) {
                    console.error(`[KataGo STDERR] ${stderrText}`);
                }
            });
            
            this.process.on('exit', (code, signal) => {
                const errorMsg = `[KataGo] Process exited with code ${code}, signal ${signal}.`;
                console.error(errorMsg);
                this.cleanup();
                this.readyPromise = null; // Allow restart
                reject(new Error(errorMsg));
            });
            
            this.process.on('error', (err) => {
                const errorMsg = `[KataGo] Process error: ${err.message}`;
                console.error(errorMsg);
                this.cleanup();
                this.readyPromise = null;
                reject(new Error(errorMsg));
            });
    }

    private cleanup() {
        this.isStarting = false;
        this.process = null;
        this.pendingQueries.forEach(({ reject, timeout }) => {
            clearTimeout(timeout);
            reject(new Error("KataGo process exited."));
        });
        this.pendingQueries.clear();
    }

    private processStdoutData(data: any) {
        this.stdoutBuffer += data.toString();
        let newlineIndex;
        while ((newlineIndex = this.stdoutBuffer.indexOf('\n')) !== -1) {
            const line = this.stdoutBuffer.substring(0, newlineIndex);
            this.stdoutBuffer = this.stdoutBuffer.substring(newlineIndex + 1);
            if (line.trim()) {
                try {
                    const response = JSON.parse(line);
                    const query = this.pendingQueries.get(response.id);
                    if (query) {
                        clearTimeout(query.timeout);
                        query.resolve(response);
                        this.pendingQueries.delete(response.id);
                    } else {
                        // 응답받았지만 대기 중인 쿼리가 없는 경우 (이미 타임아웃됨)
                        // 조용히 무시
                    }
                } catch (e) {
                    // JSON 파싱 실패는 일반적인 로그 라인이거나 에러 메시지일 수 있음
                    // 중요한 메시지만 로깅
                    if (line.includes('error') || line.includes('Error') || line.includes('ERROR')) {
                        console.error('[KataGo] Error line from stdout:', line);
                    } else if (line.includes('id') && line.includes('query')) {
                        // JSON처럼 보이지만 파싱 실패한 경우 로깅
                        console.warn('[KataGo] Failed to parse response line:', line.substring(0, 100));
                    }
                }
            }
        }
    }

    public async query(analysisQuery: any): Promise<any> {
        if (!this.process) {
            try {
                await this.start();
            } catch (e: any) {
                // If start() fails (e.g., file not found), reject the query.
                console.error('[KataGo] Failed to start:', e);
                return Promise.reject(e);
            }
        }

        // 프로세스가 준비되지 않았으면 대기
        if (!this.process || !this.process.stdin) {
            console.error('[KataGo] Process or stdin is not available.');
            return Promise.reject(new Error('KataGo process is not ready.'));
        }

        // stdin을 변수에 미리 저장 (null 체크 완료)
        const stdin = this.process.stdin;
        if (!stdin) {
            return Promise.reject(new Error('KataGo stdin is not available.'));
        }

        return new Promise((resolve, reject) => {
            const id = analysisQuery.id;
            
            const timeout = setTimeout(() => {
                console.error(`[KataGo] Query ${id} timed out after 60 seconds.`);
                this.pendingQueries.delete(id);
                reject(new Error(`KataGo query ${id} timed out after 60 seconds.`));
            }, 60000); // 60초로 증가 (계가에 더 많은 시간 필요)
            
            this.pendingQueries.set(id, { resolve, reject, timeout });
            
            try {
                const queryString = JSON.stringify(analysisQuery) + '\n';
                const written = stdin.write(queryString, (err) => {
                    if (err) {
                        console.error('[KataGo] Write to stdin error:', err);
                        clearTimeout(timeout);
                        this.pendingQueries.delete(id);
                        reject(err);
                    }
                });
                
                if (!written) {
                    // 버퍼가 가득 찬 경우 (조용히 처리)
                    stdin.once('drain', () => {
                        // 버퍼가 비워짐
                    });
                }
            } catch (err: any) {
                console.error('[KataGo] Error writing to stdin:', err);
                clearTimeout(timeout);
                this.pendingQueries.delete(id);
                reject(err);
            }
        });
    }
}

let kataGoManager: KataGoManager | null = null;

const getKataGoManager = (): KataGoManager => {
    if (!kataGoManager) {
        kataGoManager = new KataGoManager();
    }
    return kataGoManager;
};

// 서버 시작 시 KataGo 엔진을 미리 초기화하는 함수
export const initializeKataGo = async (): Promise<void> => {
    console.log(`[KataGo] Initialization check: IS_LOCAL=${IS_LOCAL}, USE_HTTP_API=${USE_HTTP_API}, KATAGO_API_URL=${KATAGO_API_URL || 'not set'}, NODE_ENV=${process.env.NODE_ENV}`);
    
    // 로컬 환경에서는 KataGo 프로세스를 시작하지 않음
    if (IS_LOCAL && !USE_HTTP_API) {
        console.log('[KataGo] Local environment detected. Skipping KataGo initialization (will use HTTP API if KATAGO_API_URL is set).');
        return;
    }

    // HTTP API를 사용하는 경우 프로세스 초기화 불필요
    if (USE_HTTP_API) {
        console.log(`[KataGo] Using HTTP API: ${KATAGO_API_URL}`);
        console.log(`[KataGo] HTTP API mode: KataGo analysis will be performed via HTTP requests to ${KATAGO_API_URL}`);
        return;
    }

    // 배포 환경에서 로컬 프로세스 사용하는 경우에만 초기화
    console.log('[KataGo] Attempting to initialize local KataGo process...');
    try {
        const manager = getKataGoManager();
        await manager.ensureStarted();
        console.log('[KataGo] Engine ready. Local process initialized successfully.');
    } catch (error: any) {
        console.error('[KataGo] Failed to initialize local process:', error.message);
        console.error('[KataGo] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        console.error('[KataGo] If you want to use HTTP API instead, set KATAGO_API_URL environment variable.');
        // 초기화 실패해도 서버는 계속 실행 (KataGo 없이도 서버는 동작 가능)
    }
};

export const analyzeGame = async (session: LiveGameSession, options?: { maxVisits?: number }): Promise<AnalysisResult> => {
    // Only modes that alter past moves (like missile go) or have a pre-set board (single player) need to send the full board state.
    const useBoardStateForAnalysis = session.mode === types.GameMode.Missile ||
                                   (session.mode === types.GameMode.Mix && session.settings.mixedModes?.includes(types.GameMode.Missile)) ||
                                   session.isSinglePlayer;

    let query: any;
    let isCurrentPlayerWhite: boolean;

    if (useBoardStateForAnalysis) {
        // For these modes, send the current board state directly.
        // 미리 배치된 돌(baseStones)과 히든돌도 포함하여 정확한 계가 수행
        const initialStones: [string, string][] = [];
        const processedPoints = new Set<string>();
        
        // 1. 현재 보드 상태의 모든 돌 추가
        for (let y = 0; y < session.settings.boardSize; y++) {
            for (let x = 0; x < session.settings.boardSize; x++) {
                if (session.boardState[y][x] !== types.Player.None) {
                    const pointKey = `${x},${y}`;
                    processedPoints.add(pointKey);
                    initialStones.push([
                        session.boardState[y][x] === types.Player.Black ? 'B' : 'W',
                        pointToKataGoMove({ x, y }, session.settings.boardSize)
                    ]);
                }
            }
        }
        
        // 2. 베이스 돌 추가 (미리 배치된 돌, moveHistory에 없을 수 있음)
        const baseStones_p1 = (session as any).baseStones_p1 || [];
        const baseStones_p2 = (session as any).baseStones_p2 || [];
        const blackPlayerId = session.blackPlayerId;
        const whitePlayerId = session.whitePlayerId;
        
        for (const stone of baseStones_p1) {
            const pointKey = `${stone.x},${stone.y}`;
            if (!processedPoints.has(pointKey)) {
                processedPoints.add(pointKey);
                const player = session.player1.id === blackPlayerId ? 'B' : 'W';
                initialStones.push([
                    player,
                    pointToKataGoMove({ x: stone.x, y: stone.y }, session.settings.boardSize)
                ]);
            }
        }
        
        for (const stone of baseStones_p2) {
            const pointKey = `${stone.x},${stone.y}`;
            if (!processedPoints.has(pointKey)) {
                processedPoints.add(pointKey);
                const player = session.player2.id === blackPlayerId ? 'B' : 'W';
                initialStones.push([
                    player,
                    pointToKataGoMove({ x: stone.x, y: stone.y }, session.settings.boardSize)
                ]);
            }
        }
        
        // 3. 히든돌 처리: moveHistory에 있지만 boardState에 반영되지 않은 경우를 대비
        // (히든돌은 이미 boardState에 반영되어 있으므로 추가 처리 불필요)
        // 단, moveHistory를 기반으로 한 분석에서 누락될 수 있으므로 확인
        
        isCurrentPlayerWhite = session.currentPlayer === types.Player.White;

        query = {
            id: `query-${randomUUID()}`,
            initialStones: initialStones,
            initialPlayer: isCurrentPlayerWhite ? 'W' : 'B',
            moves: [], // No moves, since we provided the final state.
            rules: "korean",
            komi: session.finalKomi ?? session.settings.komi,
            boardXSize: session.settings.boardSize,
            boardYSize: session.settings.boardSize,
            maxVisits: options?.maxVisits ?? 1000,
            includePolicy: true,
            includeOwnership: true,
        };
    } else {
        // For standard games, send the move history.
        // 베이스 돌과 히든돌도 고려하여 정확한 계가 수행
        const moves: [string, string][] = [];
        const processedPoints = new Set<string>();
        
        // 1. 베이스 돌을 먼저 추가 (게임 시작 전에 배치된 돌)
        const baseStones_p1 = (session as any).baseStones_p1 || [];
        const baseStones_p2 = (session as any).baseStones_p2 || [];
        const blackPlayerId = session.blackPlayerId;
        const whitePlayerId = session.whitePlayerId;
        
        for (const stone of baseStones_p1) {
            const pointKey = `${stone.x},${stone.y}`;
            processedPoints.add(pointKey);
            const player = session.player1.id === blackPlayerId ? 'B' : 'W';
            moves.push([
                player,
                pointToKataGoMove({ x: stone.x, y: stone.y }, session.settings.boardSize)
            ]);
        }
        
        for (const stone of baseStones_p2) {
            const pointKey = `${stone.x},${stone.y}`;
            processedPoints.add(pointKey);
            const player = session.player2.id === blackPlayerId ? 'B' : 'W';
            moves.push([
                player,
                pointToKataGoMove({ x: stone.x, y: stone.y }, session.settings.boardSize)
            ]);
        }
        
        // 2. moveHistory의 모든 수 추가 (히든돌 포함)
        for (const move of session.moveHistory) {
            if (move.x === -1 && move.y === -1) continue; // 패스는 제외
            const pointKey = `${move.x},${move.y}`;
            // 이미 베이스 돌로 처리된 위치는 제외 (중복 방지)
            if (!processedPoints.has(pointKey)) {
                processedPoints.add(pointKey);
                moves.push([
                    move.player === Player.Black ? 'B' : 'W',
                    pointToKataGoMove({ x: move.x, y: move.y }, session.settings.boardSize)
                ]);
            }
        }
        
        isCurrentPlayerWhite = moves.length % 2 !== 0;

        query = {
            id: `query-${randomUUID()}`,
            moves: moves,
            rules: "korean",
            komi: session.finalKomi ?? session.settings.komi,
            boardXSize: session.settings.boardSize,
            boardYSize: session.settings.boardSize,
            maxVisits: options?.maxVisits ?? 1000,
            includePolicy: true,
            includeOwnership: true,
        };
    }

    // HTTP API를 사용하는 경우 queryKataGoViaHttp 함수 정의
    const queryKataGoViaHttp = async (analysisQuery: any): Promise<any> => {
        if (!KATAGO_API_URL) {
            throw new Error('KATAGO_API_URL is not set');
        }
        
        return new Promise((resolve, reject) => {
            const url = new URL(KATAGO_API_URL);
            const isHttps = url.protocol === 'https:';
            const httpModule = isHttps ? https : http;
            
            const postData = JSON.stringify(analysisQuery);
            
            const options = {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData)
                },
                timeout: 120000 // 120초 타임아웃 (계가에 더 많은 시간 필요)
            };
            
            const req = httpModule.request(url, options, (res) => {
                let responseData = '';
                
                res.on('data', (chunk) => {
                    responseData += chunk;
                });
                
                res.on('end', () => {
                    if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                        try {
                            const parsed = JSON.parse(responseData);
                            resolve(parsed);
                        } catch (parseError) {
                            reject(new Error(`Failed to parse KataGo API response: ${parseError instanceof Error ? parseError.message : String(parseError)}`));
                        }
                    } else {
                        reject(new Error(`KataGo API returned status ${res.statusCode}: ${responseData}`));
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(new Error(`KataGo API request failed: ${error.message}`));
            });
            
            req.on('timeout', () => {
                req.destroy();
                reject(new Error('KataGo API request timed out after 120 seconds'));
            });
            
            req.write(postData);
            req.end();
        });
    };

    try {
        console.log(`[KataGo] Starting analysis query for game ${session.id} (isSinglePlayer: ${session.isSinglePlayer}, stageId: ${session.stageId})`);
        console.log(`[KataGo] Query details: boardSize=${query.boardXSize}x${query.boardYSize}, moves=${query.moves?.length || 0}, initialStones=${(query as any).initialStones?.length || 0}`);
        console.log(`[KataGo] USE_HTTP_API=${USE_HTTP_API}, KATAGO_API_URL=${KATAGO_API_URL || 'not set'}, IS_LOCAL=${IS_LOCAL}`);
        
        let response: any;
        
        // HTTP API를 사용하는 경우
        if (USE_HTTP_API) {
            console.log(`[KataGo] Using HTTP API: ${KATAGO_API_URL}`);
            response = await queryKataGoViaHttp(query);
        } else {
            // 로컬 환경에서는 HTTP API를 사용하도록 강제 (프로세스 사용 안 함)
            if (IS_LOCAL) {
                throw new Error('KataGo is disabled in local environment. Please set KATAGO_API_URL environment variable to use HTTP API.');
            }
            // 배포 환경에서 로컬 프로세스 사용
            response = await getKataGoManager().query(query);
        }
        
        console.log(`[KataGo] Analysis query completed for game ${session.id}`);
        return kataGoResponseToAnalysisResult(session, response, isCurrentPlayerWhite);
    } catch (error) {
        console.error('[KataGo] Analysis query failed:', error);
        console.error('[KataGo] Error details:', error instanceof Error ? error.message : String(error));
        console.error('[KataGo] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        // Fallback to a default "error" state analysis result
        console.log(`[KataGo] Returning fallback analysis result for game ${session.id}`);
        return {
            winRateBlack: 50,
            winRateChange: 0,
            scoreLead: 0,
            deadStones: [], ownershipMap: null, recommendedMoves: [],
            areaScore: { black: 0, white: 0 },
            scoreDetails: {
                black: { territory: 0, captures: 0, liveCaptures: 0, deadStones: 0, baseStoneBonus: 0, hiddenStoneBonus: 0, timeBonus: 0, itemBonus: 0, total: 0 },
                white: { territory: 0, captures: 0, liveCaptures: 0, deadStones: 0, komi: 0, baseStoneBonus: 0, hiddenStoneBonus: 0, timeBonus: 0, itemBonus: 0, total: 0 },
            },
            blackConfirmed: [], whiteConfirmed: [], blackRight: [], whiteRight: [], blackLikely: [], whiteLikely: [],
        };
    }
};