import * as db from '../db.js';
import { 
    type ServerAction, 
    type User, 
    type VolatileState, 
    type HandleActionResult,
    type Guild,
    GuildMemberRole,
    GuildResearchId,
    type InventoryItem,
    type ChatMessage,
    type GuildBossBattleResult,
    type GuildMessage,
} from '../../types/index.js';
import { containsProfanity } from '../../profanity.js';
import { createDefaultGuild } from '../initialData.js';
import { GUILD_CREATION_COST, GUILD_DONATION_DIAMOND_COST, GUILD_DONATION_DIAMOND_LIMIT, GUILD_DONATION_DIAMOND_REWARDS, GUILD_DONATION_GOLD_COST, GUILD_DONATION_GOLD_LIMIT, GUILD_DONATION_GOLD_REWARDS, GUILD_LEAVE_COOLDOWN_MS, GUILD_RESEARCH_PROJECTS, GUILD_CHECK_IN_MILESTONE_REWARDS, GUILD_SHOP_ITEMS, CONSUMABLE_ITEMS, MATERIAL_ITEMS, GUILD_BOSSES } from '../../constants/index.js';
import * as currencyService from '../currencyService.js';
import * as guildService from '../guildService.js';
import { isSameDayKST, isDifferentWeekKST, isDifferentMonthKST } from '../../utils/timeUtils.js';
import { addItemsToInventory } from '../../utils/inventoryUtils.js';
import { openGuildGradeBox } from '../shop.js';
import { randomUUID } from 'crypto';
import { updateQuestProgress } from '../questService.js';
import { calculateGuildMissionXp } from '../../utils/guildUtils.js';
import { broadcast } from '../socket.js';

const getRandomInt = (min: number, max: number): number => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

const getResearchCost = (researchId: GuildResearchId, level: number): number => {
    const project = GUILD_RESEARCH_PROJECTS[researchId];
    if (!project) return Infinity;
    return Math.floor(project.baseCost * Math.pow(project.costMultiplier, level));
};

const getResearchTimeMs = (researchId: GuildResearchId, level: number): number => {
    const project = GUILD_RESEARCH_PROJECTS[researchId];
    if(!project) return 0;
    const hours = project.baseTimeHours + (project.timeIncrementHours * level);
    return hours * 60 * 60 * 1000;
};


export const handleGuildAction = async (volatileState: VolatileState, action: ServerAction & { userId: string }, user: User): Promise<HandleActionResult> => {
    const { type, payload } = action;
    if (process.env.NODE_ENV === 'development') {
        console.log(`[handleGuildAction] Received action: ${type}, userId: ${user.id}`);
    }
    let needsSave = false;
    
    // Get guilds from database
    const guilds = (await db.getKV<Record<string, Guild>>('guilds')) || {};
    
    // Import guildRepository to check GuildMember
    const guildRepo = await import('../prisma/guildRepository.js');

    // Lazy migration for chat message IDs to support deleting old messages
    for (const guild of Object.values(guilds)) {
        if (guild.chatHistory) {
            for (const msg of guild.chatHistory) {
                // Only add IDs to user messages that are missing one and have a valid user object
                if (!msg.id && !msg.system && msg.user && typeof msg.user.id === 'string') {
                    msg.id = `msg-guild-${globalThis.crypto.randomUUID()}`;
                    needsSave = true;
                }
            }
        }
    }

    if (needsSave) {
        await db.setKV('guilds', guilds);
        await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
    }


    switch (type) {
        case 'CREATE_GUILD': {
            try {
                const { name, description, isPublic, joinType } = payload;
            
            // Validate name
            if (!name || typeof name !== 'string') {
                return { error: '길드 ?�름???�력?�주?�요.' };
            }
            const trimmedName = name.trim();
            if (trimmedName.length < 2 || trimmedName.length > 6) {
                return { error: '길드 ?�름?� 2???�상 6???�하?�야 ?�니??' };
            }
            
            // Validate description if provided
            const trimmedDescription = description ? String(description).trim() : '';
            if (trimmedDescription && trimmedDescription.length > 200) {
                return { error: '길드 ?�명?� 200???�하?�야 ?�니??' };
            }
            
            // Check for profanity
            if (containsProfanity(trimmedName) || (trimmedDescription && containsProfanity(trimmedDescription))) {
                return { error: '부?�절???�어가 ?�함?�어 ?�습?�다.' };
            }
            
            // For admin users, check and remove any existing guild leadership or membership
            if (user.isAdmin) {
                // Check if admin is a leader of a guild
                const existingLeaderGuild = await guildRepo.getGuildByLeaderId(user.id);
                if (existingLeaderGuild) {
                    console.log(`[CREATE_GUILD] Admin user ${user.id} is already a leader of guild ${existingLeaderGuild.id}, deleting it...`);
                    await guildRepo.deleteGuild(existingLeaderGuild.id);
                }
                
                // Check and remove GuildMember if exists
                const existingGuildMember = await guildRepo.getGuildMemberByUserId(user.id);
                if (existingGuildMember) {
                    console.log(`[CREATE_GUILD] Admin user ${user.id} is a member of guild ${existingGuildMember.guildId}, removing membership...`);
                    await guildRepo.removeGuildMember(existingGuildMember.guildId, user.id);
                }
                
                // Clear user.guildId if set (will be updated after guild creation)
                if (user.guildId) {
                    user.guildId = undefined;
                    // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
                    db.updateUser(user).catch(err => {
                        console.error(`[CREATE_GUILD] Failed to clear guildId for user ${user.id}:`, err);
                    });
                }
            } else {
                // For non-admin users, check if already in a guild
                const existingGuildMember = await guildRepo.getGuildMemberByUserId(user.id);
                if (existingGuildMember || user.guildId) {
                    return { error: '?��? 길드??가?�되???�습?�다.' };
                }
            }
            
            if (!user.isAdmin) {
                // ?�이?�몬???�??변??(BigInt?????�음)
                const userDiamonds = typeof user.diamonds === 'bigint' ? Number(user.diamonds) : (user.diamonds || 0);
                if (userDiamonds < GUILD_CREATION_COST) {
                    return { error: `?�이?��? 부족합?�다. (?�요: ${GUILD_CREATION_COST}�? 보유: ${userDiamonds}�?` };
                }
                currencyService.spendDiamonds(user, GUILD_CREATION_COST, '길드 창설');
            }
            
            // Check for duplicate name using Prisma (to ensure consistency with delete operations)
            const existingGuild = await guildRepo.getGuildByName(trimmedName);
            if (existingGuild) {
                return { error: '?��? ?�용 중인 길드 ?�름?�니??' };
            }

            const guildId = `guild-${globalThis.crypto.randomUUID()}`;
            const newGuild = createDefaultGuild(guildId, trimmedName, trimmedDescription || undefined, isPublic, user);
            
            // 중간???�성??길드???�음 매칭(?�요???�는 금요????참여
            const { getKSTDay, getStartOfDayKST } = await import('../../utils/timeUtils.js');
            const now = Date.now();
            const kstDay = getKSTDay(now);
            const todayStart = getStartOfDayKST(now);
            
            // ?�음 매칭 ?�짜 계산
            let daysUntilNext = 0;
            if (kstDay === 1) {
                // ?�요??- 금요?�까지 (4????
                daysUntilNext = 4;
            } else if (kstDay === 2 || kstDay === 3) {
                // ?�요?? ?�요??- 금요?�까지
                daysUntilNext = 5 - kstDay;
            } else if (kstDay === 4) {
                // 목요??- ?�음 ?�요?�까지 (3????
                daysUntilNext = 3;
            } else if (kstDay === 5) {
                // 금요??- ?�음 ?�요?�까지 (3????
                daysUntilNext = 3;
            } else {
                // ?�요?? ?�요??- ?�음 ?�요?�까지
                daysUntilNext = (8 - kstDay) % 7;
            }
            
            const nextMatchDate = todayStart + (daysUntilNext * 24 * 60 * 60 * 1000);
            (newGuild as any).nextWarMatchDate = nextMatchDate;
            
            guilds[guildId] = newGuild;
            
            // Also create guild in Prisma database for consistency
            try {
                await guildRepo.createGuild({
                    name: trimmedName,
                    leaderId: user.id,
                    description: trimmedDescription || undefined,
                    emblem: newGuild.icon,
                    settings: { isPublic },
                });
                // Creator is automatically added as leader by createGuild
            } catch (error) {
                console.error('[CREATE_GUILD] Failed to create guild in Prisma:', error);
                // Continue even if Prisma creation fails - KV store is primary
            }
            
            // Update user's guildId
            user.guildId = guildId;
            
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[CREATE_GUILD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildId', 'diamonds']);
            
                return { clientResponse: { guild: newGuild, updatedUser: user } };
            } catch (error: any) {
                console.error('[CREATE_GUILD] 오류:', error);
                return { error: error.message || '길드 창설에 실패했습니다.' };
            }
        }
        
        case 'JOIN_GUILD': {
            try {
            const { guildId } = payload;
            const guild = guilds[guildId];

            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };
            if (user.guildId) return { error: '?��? 길드??가?�되???�습?�다.' };
            if (!guild.members) guild.members = [];
            if (guild.members.length >= (guild.memberLimit || 30)) return { error: '길드 ?�원??가??찼습?�다.' };

            // joinType???�라 가??방식 결정
            const joinType = guild.joinType || 'application'; // 기본값�? ?�청가??
            const isApplicationPending = guild.applicants?.some((app: any) => 
                (typeof app === 'string' ? app : app.userId) === user.id
            );

            if (joinType === 'free') {
                // ?�유가?? 빈자리�? ?�으�??�동 가??
                if (!guild.members) guild.members = [];
                guild.members.push({
                    id: `member-${user.id}-${guild.id}`,
                    guildId: guild.id,
                    userId: user.id,
                    nickname: user.nickname,
                    role: GuildMemberRole.Member,
                    joinDate: Date.now(),
                    contributionTotal: 0,
                    weeklyContribution: 0,
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
                user.guildId = guild.id;
                // 기존 ?�청???�으�??�거
                if (guild.applicants) {
                    guild.applicants = guild.applicants.filter((app: any) => 
                        (typeof app === 'string' ? app : app.userId) !== user.id
                    );
                }
                if (user.guildApplications) {
                    user.guildApplications = user.guildApplications.filter(app => app.guildId !== guildId);
                }
            } else {
                // ?�청가?? 길드??부길드???�인 ?�요
                if (isApplicationPending) return { error: '?��? 가???�청???�습?�다.' };
                if (!guild.applicants) guild.applicants = [];
                guild.applicants.push({ userId: user.id, appliedAt: Date.now() });
                if (!user.guildApplications) user.guildApplications = [];
                user.guildApplications.push({ guildId: guild.id, appliedAt: Date.now() });
            }

            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[JOIN_GUILD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(user, ['guildId', 'guildApplications']);
                
                return { clientResponse: { updatedUser: user } };
            } catch (error: any) {
                console.error('[JOIN_GUILD] 오류:', error);
                return { error: error.message || '길드 가입에 실패했습니다.' };
            }
        }
        
        case 'LIST_GUILDS': {
            try {
                const { searchQuery, limit } = payload;
                const query = searchQuery?.trim() || '';
                const limitNum = limit || 100;
                
                // Prisma를 통해 길드 목록 조회
                const dbGuilds = await guildRepo.listGuilds(query, limitNum);
                
                // KV store의 길드 데이터와 병합
                const resultGuilds = await Promise.all(
                    dbGuilds.map(async (dbGuild) => {
                        const kvGuild = guilds[dbGuild.id];
                        if (kvGuild) {
                            // KV store에 있으면 KV 데이터 사용
                            return {
                                id: kvGuild.id,
                                name: kvGuild.name,
                                description: kvGuild.description || undefined,
                                icon: kvGuild.icon?.startsWith('/images/guild/icon') 
                                    ? kvGuild.icon.replace('/images/guild/icon', '/images/guild/profile/icon')
                                    : (kvGuild.icon || '/images/guild/profile/icon1.png'),
                                level: kvGuild.level,
                                memberCount: kvGuild.members?.length || 0,
                                memberLimit: kvGuild.memberLimit || 30,
                                isPublic: kvGuild.isPublic !== false,
                            };
                        } else {
                            // KV store에 없으면 DB 데이터 사용
                            const dbIcon = dbGuild.emblem || '/images/guild/profile/icon1.png';
                            const dbSettings = (dbGuild.settings as any) || {};
                            const dbIsPublic = dbSettings.isPublic !== undefined ? dbSettings.isPublic : true;
                            
                            return {
                                id: dbGuild.id,
                                name: dbGuild.name,
                                description: dbGuild.description || undefined,
                                icon: dbIcon.startsWith('/images/guild/icon') 
                                    ? dbIcon.replace('/images/guild/icon', '/images/guild/profile/icon')
                                    : dbIcon,
                                level: dbGuild.level,
                                memberCount: dbGuild.memberCount,
                                memberLimit: 30,
                                isPublic: dbIsPublic,
                            };
                        }
                    })
                );
                
                // 공개 길드만 필터링
                const filteredGuilds = resultGuilds.filter(g => g.isPublic !== false);
                
                // 정렬: 레벨 내림차순, 이름 오름차순
                filteredGuilds.sort((a, b) => {
                    if (b.level !== a.level) return b.level - a.level;
                    return a.name.localeCompare(b.name);
                });
                
                return { 
                    clientResponse: { 
                        guilds: filteredGuilds,
                        total: filteredGuilds.length
                    } 
                };
            } catch (error: any) {
                console.error('[LIST_GUILDS] 오류:', error);
                return { 
                    error: error.message || '길드 목록을 불러오는데 실패했습니다.' 
                };
            }
        }

        case 'GUILD_CANCEL_APPLICATION': {
            const { guildId } = payload;
            const guild = guilds[guildId];
            if (guild && guild.applicants) {
                guild.applicants = guild.applicants.filter((app: any) => 
                    (typeof app === 'string' ? app : app.userId) !== user.id
                );
                await db.setKV('guilds', guilds);
                await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            }
                if (user.guildApplications) {
                    user.guildApplications = user.guildApplications.filter(app => app.guildId !== guildId);
                    // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
                    db.updateUser(user).catch(err => {
                        console.error(`[GUILD_CANCEL_APPLICATION] Failed to save user ${user.id}:`, err);
                    });

                    // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
                    const { broadcastUserUpdate } = await import('../socket.js');
                    broadcastUserUpdate(user, ['guildApplications']);
                }
            return { clientResponse: { updatedUser: user } };
        }
        
        case 'GUILD_ACCEPT_APPLICANT': {
            const { guildId, applicantId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: '길드�?찾을 ???�습?�다.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            if (!myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: '권한???�습?�다.' };
            }
            if (guild.members.length >= (guild.memberLimit || 30)) return { error: '길드 ?�원??가??찼습?�다.' };

            const applicant = await db.getUser(applicantId);
            if (!applicant || applicant.guildId) {
                if (guild.applicants) {
                    guild.applicants = guild.applicants.filter((app: any) => 
                        (typeof app === 'string' ? app : app.userId) !== applicantId
                    );
                }
                await db.setKV('guilds', guilds);
                return { error: '?�?�이 ?��? ?�른 길드??가?�했?�니??' };
            }

            if (!guild.members) guild.members = [];
            guild.members.push({ 
                id: `member-${applicant.id}-${guild.id}`,
                guildId: guild.id,
                userId: applicant.id, 
                nickname: applicant.nickname, 
                role: GuildMemberRole.Member, 
                joinDate: Date.now(), 
                contributionTotal: 0, 
                weeklyContribution: 0,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            if (guild.applicants) {
                guild.applicants = guild.applicants.filter((app: any) => 
                    (typeof app === 'string' ? app : app.userId) !== applicantId
                );
            }
            applicant.guildId = guild.id;
            if (applicant.guildApplications) {
                applicant.guildApplications = applicant.guildApplications.filter(app => app.guildId !== guildId);
            }
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(applicant).catch(err => {
                console.error(`[GUILD_ACCEPT_APPLICANT] Failed to save applicant ${applicant.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(applicant, ['guildId', 'guildApplications']);
            
            return { clientResponse: { guilds } };
        }

        case 'GUILD_REJECT_APPLICANT': {
            const { guildId, applicantId } = payload;
            const guild = guilds[guildId];
            const myMemberInfo = guild?.members.find(m => m.userId === user.id);
             if (!guild || !myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: '권한???�습?�다.' };
            }
            if (guild.applicants) {
                guild.applicants = guild.applicants.filter((app: any) => 
                    (typeof app === 'string' ? app : app.userId) !== applicantId
                );
            }
            
            const applicant = await db.getUser(applicantId);
            if (applicant && applicant.guildApplications) {
                applicant.guildApplications = applicant.guildApplications.filter(app => app.guildId !== guildId);
                
                // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
                db.updateUser(applicant).catch(err => {
                    console.error(`[GUILD_REJECT_APPLICANT] Failed to save applicant ${applicant.id}:`, err);
                });

                // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(applicant, ['guildApplications']);
            }

            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { guilds } };
        }

        case 'GUILD_LEAVE': {
            const { guildId } = payload;
            const guild = guilds[guildId];
            if (!guild || user.guildId !== guildId) return { error: '길드 ?�보�?찾을 ???�습?�다.' };
            
            const memberInfo = guild.members.find(m => m.userId === user.id);
            if (!memberInfo) return { error: '길드?�이 ?�닙?�다.' };
            if (memberInfo.role === GuildMemberRole.Master && guild.members.length > 1) {
                return { error: '길드?�이 길드�??�나?�면 먼�? ?�른 길드?�에�?길드?�을 ?�임?�야 ?�니??' };
            }
            
            if (memberInfo.role === GuildMemberRole.Master && guild.members.length === 1) {
                delete guilds[guildId]; // Last member, dissolve guild
            } else {
                guild.members = guild.members.filter(m => m.userId !== user.id);
            }
            
            user.guildId = null;
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[GUILD_LEAVE] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildId']);
            
            return { clientResponse: { updatedUser: user, guilds } };
        }

        case 'GUILD_KICK_MEMBER': {
            const { guildId, targetMemberId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: '길드�?찾을 ???�습?�다.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const targetMemberInfo = guild.members.find(m => m.userId === targetMemberId);

            if (!myMemberInfo || !targetMemberInfo) return { error: '?�보�?찾을 ???�습?�다.' };
            if ((myMemberInfo.role === GuildMemberRole.Master && targetMemberInfo.role !== GuildMemberRole.Master) || 
                (myMemberInfo.role === GuildMemberRole.Vice && targetMemberInfo.role === GuildMemberRole.Member)) {
                
                guild.members = guild.members.filter(m => m.userId !== targetMemberId);
                const targetUser = await db.getUser(targetMemberId);
                if (targetUser) {
                    targetUser.guildId = undefined;
                    
                    // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
                    db.updateUser(targetUser).catch(err => {
                        console.error(`[GUILD_KICK_MEMBER] Failed to save target user ${targetUser.id}:`, err);
                    });

                    // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
                    const { broadcastUserUpdate } = await import('../socket.js');
                    broadcastUserUpdate(targetUser, ['guildId']);
                }
                await db.setKV('guilds', guilds);
                await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            } else {
                return { error: '권한???�습?�다.' };
            }
            return { clientResponse: { guilds } };
        }
        
        case 'GUILD_PROMOTE_MEMBER':
        case 'GUILD_DEMOTE_MEMBER': {
             const { guildId, targetMemberId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: '길드�?찾을 ???�습?�다.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const targetMemberInfo = guild.members.find(m => m.userId === targetMemberId);
            if (!myMemberInfo || !targetMemberInfo || myMemberInfo.role !== GuildMemberRole.Master) {
                return { error: '권한???�습?�다.' };
            }
            if (type === 'GUILD_PROMOTE_MEMBER' && targetMemberInfo.role === GuildMemberRole.Member) {
                targetMemberInfo.role = GuildMemberRole.Vice;
            } else if (type === 'GUILD_DEMOTE_MEMBER' && targetMemberInfo.role === GuildMemberRole.Vice) {
                targetMemberInfo.role = GuildMemberRole.Member;
            }
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { guilds } };
        }
        
        case 'GUILD_TRANSFER_MASTERSHIP': {
            const { guildId, targetMemberId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: '길드�?찾을 ???�습?�다.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const targetMemberInfo = guild.members.find(m => m.userId === targetMemberId);

            if (!myMemberInfo || !targetMemberInfo || myMemberInfo.role !== GuildMemberRole.Master) {
                return { error: '권한???�습?�다.' };
            }
            if (myMemberInfo.userId === targetMemberId) {
                return { error: '?�기 ?�신?�게 ?�임?????�습?�다.' };
            }
            
            myMemberInfo.role = GuildMemberRole.Member;
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { guilds } };
        }

        case 'GUILD_UPDATE_PROFILE': {
             const { guildId, description, isPublic, icon, joinType } = payload;
            const guild = guilds[guildId];
            const myMemberInfo = guild?.members.find(m => m.userId === user.id);
            if (!guild || !myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: '권한???�습?�다.' };
            }
            if(description !== undefined) guild.description = description;
            if(isPublic !== undefined) guild.isPublic = isPublic;
            if(joinType !== undefined) guild.joinType = joinType;
            if(icon !== undefined) {
                guild.icon = icon;
                // DB?�도 ?�데?�트 (emblem ?�드)
                const dbGuilds = await db.getKV<Record<string, Guild>>('guilds') || {};
                if (dbGuilds[guildId]) {
                    dbGuilds[guildId].emblem = icon;
                }
            }
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { guilds } };
        }

        case 'GUILD_UPDATE_ANNOUNCEMENT': {
            const { guildId, announcement } = payload;
            const guild = guilds[guildId];
            const myMemberInfo = guild?.members.find(m => m.userId === user.id);
             if (!guild || !myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: '권한???�습?�다.' };
            }
            guild.announcement = announcement;
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { guilds } };
        }

        case 'GUILD_CHECK_IN': {
            if (process.env.NODE_ENV === 'development') {
                console.log(`[handleGuildAction] Processing GUILD_CHECK_IN for user ${user.id}, guildId: ${user.guildId}`);
            }
            const now = Date.now();
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };

            if (!guild.checkIns) guild.checkIns = {};
            if (isSameDayKST(guild.checkIns[user.id], now)) return { error: '?�늘 ?��? 출석?�습?�다.' };

            guild.checkIns[user.id] = now;
            
            await guildService.updateGuildMissionProgress(user.guildId, 'checkIns', 1, guilds);
            
            needsSave = true;
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            if (process.env.NODE_ENV === 'development') {
                console.log(`[handleGuildAction] GUILD_CHECK_IN completed successfully`);
            }
            return { clientResponse: { guilds, updatedUser: user } };
        }
        case 'GUILD_CLAIM_CHECK_IN_REWARD': {
             const { milestoneIndex } = payload;
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };
            
            const now = Date.now();
            const todaysCheckIns = Object.values(guild.checkIns || {}).filter(ts => isSameDayKST(ts, now)).length;
            const milestone = GUILD_CHECK_IN_MILESTONE_REWARDS[milestoneIndex];

            if (!milestone || todaysCheckIns < milestone.count) return { error: '보상 조건??만족?��? 못했?�니??' };
            if (!guild.dailyCheckInRewardsClaimed) guild.dailyCheckInRewardsClaimed = [];
            if (guild.dailyCheckInRewardsClaimed.some(c => c.userId === user.id && c.milestoneIndex === milestoneIndex)) return { error: '?��? ?�령??보상?�니??' };
            
            user.guildCoins = (user.guildCoins || 0) + milestone.reward.guildCoins;
            guild.dailyCheckInRewardsClaimed.push({ userId: user.id, milestoneIndex });

            await db.setKV('guilds', guilds);
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[GUILD_CLAIM_CHECK_IN_REWARD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildCoins']);
            
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { updatedUser: user, guilds } };
        }
        case 'GUILD_CLAIM_MISSION_REWARD': {
            const { missionId } = payload;
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };
        
            const mission = guild.weeklyMissions.find(m => m.id === missionId);
        
            if (!mission) return { error: '미션??찾을 ???�습?�다.' };
            if (!mission.isCompleted) return { error: '?�직 ?�료?��? ?��? 미션?�니??' };
            if (mission.claimedBy.includes(user.id)) return { error: '?��? ?�령??보상?�니??' };
            
            // 초기????지??보상?� 받을 ???�도�?체크
            const now = Date.now();
            if (guild.lastMissionReset && isDifferentWeekKST(guild.lastMissionReset, now)) {
                return { error: '?��? 초기?�된 미션?��?�?보상??받을 ???�습?�다.' };
            }

            // XP??미션 ?�료 ???��? 추�??�었?��?�??�기?�는 개인 보상�?지�?
            // Grant personal reward (Guild Coins)
            user.guildCoins = (user.guildCoins || 0) + mission.personalReward.guildCoins;
        
            // Mark as claimed by the current user
            mission.claimedBy.push(user.id);
            
            await db.setKV('guilds', guilds);
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[GUILD_CLAIM_MISSION_REWARD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildCoins']);
            
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { updatedUser: user, guilds } };
        }
        case 'GUILD_DONATE_GOLD':
        case 'GUILD_DONATE_DIAMOND': {
            console.log(`[handleGuildAction] Processing ${type} for user ${user.id}, guildId: ${user.guildId}`);
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };
            
            const now = Date.now();
            if (!user.isAdmin) {
                if (!user.dailyDonations || !isSameDayKST(user.dailyDonations.date, now)) {
                    user.dailyDonations = { gold: 0, diamond: 0, date: now };
                }
            }
            
            let gainedGuildCoins = 0;
            let gainedResearchPoints = 0;

            if (type === 'GUILD_DONATE_GOLD') {
                if (!user.isAdmin) {
                    if (user.dailyDonations!.gold >= GUILD_DONATION_GOLD_LIMIT) return { error: '?�늘 골드 기�? ?�도�?초과?�습?�다.' };
                    if (user.gold < GUILD_DONATION_GOLD_COST) return { error: '골드가 부족합?�다.' };
                    currencyService.spendGold(user, GUILD_DONATION_GOLD_COST, '길드 기�?');
                    user.dailyDonations!.gold++;
                }
                gainedGuildCoins = getRandomInt(GUILD_DONATION_GOLD_REWARDS.guildCoins[0], GUILD_DONATION_GOLD_REWARDS.guildCoins[1]);
                gainedResearchPoints = getRandomInt(GUILD_DONATION_GOLD_REWARDS.researchPoints[0], GUILD_DONATION_GOLD_REWARDS.researchPoints[1]);
                
                user.guildCoins += gainedGuildCoins;
                guild.researchPoints += gainedResearchPoints;
                guild.xp += GUILD_DONATION_GOLD_REWARDS.guildXp;
                guildService.addContribution(guild, user.id, GUILD_DONATION_GOLD_REWARDS.contribution);
            } else {
                if (!user.isAdmin) {
                    if (user.dailyDonations!.diamond >= GUILD_DONATION_DIAMOND_LIMIT) return { error: '?�늘 ?�이??기�? ?�도�?초과?�습?�다.' };
                    if (user.diamonds < GUILD_DONATION_DIAMOND_COST) return { error: '?�이?��? 부족합?�다.' };
                    currencyService.spendDiamonds(user, GUILD_DONATION_DIAMOND_COST, '길드 기�?');
                    await guildService.updateGuildMissionProgress(user.guildId, 'diamondsSpent', GUILD_DONATION_DIAMOND_COST, guilds);
                    user.dailyDonations!.diamond++;
                }
                gainedGuildCoins = getRandomInt(GUILD_DONATION_DIAMOND_REWARDS.guildCoins[0], GUILD_DONATION_DIAMOND_REWARDS.guildCoins[1]);
                gainedResearchPoints = getRandomInt(GUILD_DONATION_DIAMOND_REWARDS.researchPoints[0], GUILD_DONATION_DIAMOND_REWARDS.researchPoints[1]);
                
                user.guildCoins += gainedGuildCoins;
                guild.researchPoints += gainedResearchPoints;
                guild.xp += GUILD_DONATION_DIAMOND_REWARDS.guildXp;
                guildService.addContribution(guild, user.id, GUILD_DONATION_DIAMOND_REWARDS.contribution);
            }

            guildService.checkGuildLevelUp(guild);
            updateQuestProgress(user, 'guild_donate');

            await db.setKV('guilds', guilds);
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[${type}] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            const { getSelectiveUserUpdate } = await import('../utils/userUpdateHelper.js');
            const changedFields = type === 'GUILD_DONATE_GOLD' 
                ? ['gold', 'guildCoins', 'dailyDonations'] 
                : ['diamonds', 'guildCoins', 'dailyDonations'];
            broadcastUserUpdate(user, changedFields);
            
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            console.log(`[handleGuildAction] ${type} completed successfully`);
            
            // updatedUser??guildCoins?� dailyDonations가 ?�함?�도�?보장
            const updatedUser = getSelectiveUserUpdate(user, type);
            updatedUser.guildCoins = user.guildCoins;
            updatedUser.dailyDonations = user.dailyDonations;
            
            return {
                clientResponse: {
                    updatedUser, 
                    guilds,
                    donationResult: {
                        coins: gainedGuildCoins,
                        research: gainedResearchPoints,
                    }
                }
            };
        }
        
        case 'GUILD_START_RESEARCH': {
            const { guildId, researchId } = payload;
            const guild = guilds[guildId];
            const myMemberInfo = guild?.members.find(m => m.userId === user.id);
            if (!guild || !myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: '권한???�습?�다.' };
            }
            if (guild.researchTask) return { error: '?��? 진행 중인 ?�구가 ?�습?�다.' };

            const project = GUILD_RESEARCH_PROJECTS[researchId as keyof typeof GUILD_RESEARCH_PROJECTS];
            const currentLevel = guild.research?.[researchId as keyof typeof GUILD_RESEARCH_PROJECTS]?.level ?? 0;
            if (currentLevel >= project.maxLevel) return { error: '최고 ?�벨???�달?�습?�다.' };
            
            const cost = getResearchCost(researchId, currentLevel);
            const timeMs = getResearchTimeMs(researchId, currentLevel);
            if (guild.researchPoints < cost) return { error: '?�구 ?�인?��? 부족합?�다.' };
            
            guild.researchPoints -= cost;
            guild.researchTask = {
                researchId,
                completionTime: Date.now() + timeMs,
            };

            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { guilds } };
        }
        
        case 'GUILD_BUY_SHOP_ITEM': {
            const { itemId } = payload;
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };

            const itemToBuy = GUILD_SHOP_ITEMS.find(item => item.itemId === itemId);
            if (!itemToBuy) return { error: '?�점?�서 ?�당 ?�이?�을 찾을 ???�습?�다.' };
            
            if (!user.isAdmin) {
                // Check cost
                if ((user.guildCoins || 0) < itemToBuy.cost) {
                    return { error: '길드 코인??부족합?�다.' };
                }

                // Check limits
                const now = Date.now();
                if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
                const purchaseRecord = user.dailyShopPurchases[itemId];
                let purchasesThisPeriod = 0;
                
                if (purchaseRecord) {
                    const isNewPeriod = (itemToBuy.limitType === 'weekly' && isDifferentWeekKST(purchaseRecord.lastPurchaseTimestamp, now)) ||
                                        (itemToBuy.limitType === 'monthly' && isDifferentMonthKST(purchaseRecord.lastPurchaseTimestamp, now));
                    if (!isNewPeriod) {
                        purchasesThisPeriod = purchaseRecord.quantity;
                    }
                }
                
                if (purchasesThisPeriod >= itemToBuy.limit) {
                    return { error: `${itemToBuy.limitType === 'weekly' ? '주간' : '?�간'} 구매 ?�도�?초과?�습?�다.` };
                }
            }
            
            // Deduct cost and update purchase record BEFORE giving the item
            if (!user.isAdmin) {
                user.guildCoins = (user.guildCoins || 0) - itemToBuy.cost;
                
                const now = Date.now();
                if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
                const record = user.dailyShopPurchases[itemId];
                if (record) {
                    const isNewPeriod = (itemToBuy.limitType === 'weekly' && isDifferentWeekKST(record.lastPurchaseTimestamp, now)) ||
                                        (itemToBuy.limitType === 'monthly' && isDifferentMonthKST(record.lastPurchaseTimestamp, now));

                    if (isNewPeriod) {
                        record.quantity = 1;
                        record.lastPurchaseTimestamp = now;
                    } else {
                        record.quantity++;
                    }
                } else {
                    user.dailyShopPurchases[itemId] = {
                        quantity: 1,
                        lastPurchaseTimestamp: now,
                    };
                }
            }
            
            // Special handling for Stat Points
            if (itemToBuy.itemId === '보너???�탯 +5') {
                user.bonusStatPoints = (user.bonusStatPoints || 0) + 5;
                
                // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
                db.updateUser(user).catch(err => {
                    console.error(`[BUY_GUILD_SHOP_ITEM] Failed to save user ${user.id}:`, err);
                });

                // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(user, ['bonusStatPoints', 'guildCoins']);
                
                const rewardSummary = {
                    reward: { bonus: '?�탯+5' },
                    items: [],
                    title: '길드 ?�점 구매'
                };
                return { clientResponse: { updatedUser: user, rewardSummary } };
            }
            
            // Regular item handling
            let itemsToAdd: InventoryItem[] = [];
            if (itemToBuy.type === 'equipment_box') {
                itemsToAdd.push(openGuildGradeBox(itemToBuy.grade));
            } else { // 'material' or 'consumable'
                const template = [...CONSUMABLE_ITEMS, ...Object.values(MATERIAL_ITEMS)].find(t => t.name === itemToBuy.name);
                
                if (template) {
                    itemsToAdd.push({
                        ...template,
                        id: `item-${globalThis.crypto.randomUUID()}`,
                        createdAt: Date.now(),
                        quantity: 1,
                        isEquipped: false, level: 1, stars: 0, options: undefined, slot: null,
                    });
                } else {
                     console.error(`[Guild Shop] Could not find template for ${itemToBuy.name}`);
                     if (!user.isAdmin) { user.guildCoins = (user.guildCoins || 0) + itemToBuy.cost; } // Refund
                     return { error: '?�이???�보�?찾을 ???�습?�다.' };
                }
            }
            
            const { success } = addItemsToInventory(user.inventory, user.inventorySlots, itemsToAdd);
            if (!success) {
                if (!user.isAdmin) { user.guildCoins = (user.guildCoins || 0) + itemToBuy.cost; } // Refund
                return { error: '?�벤?�리 공간??부족합?�다.' };
            }
            
            // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
            db.updateUser(user).catch(err => {
                console.error(`[BUY_GUILD_SHOP_ITEM] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['inventory', 'guildCoins']);
            
            return { clientResponse: { updatedUser: user, obtainedItemsBulk: itemsToAdd } };
        }

        case 'BUY_GUILD_SHOP_ITEM': {
            const { itemId, quantity } = payload;
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };

            const itemToBuy = GUILD_SHOP_ITEMS.find(item => item.itemId === itemId);
            if (!itemToBuy) return { error: '?�점?�서 ?�당 ?�이?�을 찾을 ???�습?�다.' };

            const totalCost = itemToBuy.cost * quantity;
            if ((user.guildCoins || 0) < totalCost) {
                return { error: '길드 코인??부족합?�다.' };
            }

            const now = Date.now();
            if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
            const purchaseRecord = user.dailyShopPurchases[itemId];
            let purchasesThisPeriod = 0;

            if (purchaseRecord) {
                const isNewPeriod = (itemToBuy.limitType === 'weekly' && isDifferentWeekKST(purchaseRecord.lastPurchaseTimestamp, now)) ||
                                    (itemToBuy.limitType === 'monthly' && isDifferentMonthKST(purchaseRecord.lastPurchaseTimestamp, now));
                if (!isNewPeriod) {
                    purchasesThisPeriod = purchaseRecord.quantity;
                }
            }

            if (itemToBuy.limit !== Infinity && (purchasesThisPeriod + quantity) > itemToBuy.limit) {
                return { error: `${itemToBuy.limitType === 'weekly' ? '주간' : '?�간'} 구매 ?�도�?초과?�습?�다.` };
            }

            user.guildCoins = (user.guildCoins || 0) - totalCost;

            if (!user.dailyShopPurchases) user.dailyShopPurchases = {};
            const record = user.dailyShopPurchases[itemId];
            if (record) {
                const isNewPeriod = (itemToBuy.limitType === 'weekly' && isDifferentWeekKST(record.lastPurchaseTimestamp, now)) ||
                                    (itemToBuy.limitType === 'monthly' && isDifferentMonthKST(record.lastPurchaseTimestamp, now));

                if (isNewPeriod) {
                    record.quantity = quantity;
                    record.lastPurchaseTimestamp = now;
                } else {
                    record.quantity += quantity;
                }
            } else {
                user.dailyShopPurchases[itemId] = {
                    quantity: quantity,
                    lastPurchaseTimestamp: now,
                };
            }

            let itemsToAdd: InventoryItem[] = [];
            for (let i = 0; i < quantity; i++) {
                if (itemToBuy.type === 'equipment_box') {
                    itemsToAdd.push(openGuildGradeBox(itemToBuy.grade));
                } else { // 'material' or 'consumable'
                    const template = [...CONSUMABLE_ITEMS, ...Object.values(MATERIAL_ITEMS)].find(t => t.name === itemToBuy.name);
                    if (template) {
                        itemsToAdd.push({
                            ...template,
                            id: `item-${globalThis.crypto.randomUUID()}`,
                            createdAt: Date.now(),
                            quantity: 1,
                            isEquipped: false, level: 1, stars: 0, options: undefined, slot: null,
                        });
                    } else {
                        console.error(`[Guild Shop] Could not find template for ${itemToBuy.name}`);
                        return { error: '?�이???�보�?찾을 ???�습?�다.' };
                    }
                }
            }

            const { success } = addItemsToInventory(user.inventory, user.inventorySlots, itemsToAdd);
            if (!success) {
                user.guildCoins = (user.guildCoins || 0) + totalCost; // Refund
                return { error: '?�벤?�리 공간??부족합?�다.' };
            }

                // DB ?�데?�트�?비동기로 처리 (?�답 지??최소??
                db.updateUser(user).catch(err => {
                    console.error(`[BUY_GUILD_SHOP_ITEM] Failed to save user ${user.id}:`, err);
                });

                // WebSocket?�로 ?�용???�데?�트 브로?�캐?�트 (최적?�된 ?�수 ?�용)
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(user, ['inventory', 'guildCoins']);
                
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } }); // Broadcast guilds

            return { clientResponse: { updatedUser: user, obtainedItemsBulk: itemsToAdd } };
        }

        case 'GET_GUILD_WAR_DATA': {
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            
            const guilds = await db.getKV<Record<string, Guild>>('guilds') || {};
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };
            
            // 길드???�이??가?�오�?
            const activeWars = await db.getKV<any[]>('activeGuildWars') || [];
            const activeWar = activeWars.find(w => 
                (w.guild1Id === user.guildId || w.guild2Id === user.guildId) && 
                w.status === 'active'
            );
            
            // ?�음 매칭 ?�짜 가?�오�?(길드???�정?�어 ?�으�??�용, ?�으�?계산)
            let nextMatchDate = (guild as any).nextWarMatchDate;
            if (!nextMatchDate) {
                // ?�음 매칭 ?�짜 계산
                const { getKSTDay, getStartOfDayKST } = await import('../../utils/timeUtils.js');
                const now = Date.now();
                const kstDay = getKSTDay(now);
                const todayStart = getStartOfDayKST(now);
                
                let daysUntilNext = 0;
                if (kstDay === 1) {
                    daysUntilNext = 4; // ?�요??- 금요?�까지
                } else if (kstDay === 2 || kstDay === 3) {
                    daysUntilNext = 5 - kstDay; // ?�요?? ?�요??- 금요?�까지
                } else if (kstDay === 4) {
                    daysUntilNext = 3; // 목요??- ?�음 ?�요?�까지
                } else if (kstDay === 5) {
                    daysUntilNext = 3; // 금요??- ?�음 ?�요?�까지
                } else {
                    daysUntilNext = (8 - kstDay) % 7; // ?�요?? ?�요??- ?�음 ?�요?�까지
                }
                
                nextMatchDate = todayStart + (daysUntilNext * 24 * 60 * 60 * 1000);
            }
            
            return { clientResponse: { activeWar, guilds, nextMatchDate } };
        }
        
        case 'GET_GUILD_INFO': {
            try {
                if (!user.guildId) return { error: "가?�한 길드가 ?�습?�다." };
                
                // Prisma?�서??길드 존재 ?��? ?�인
                const dbGuild = await guildRepo.getGuildById(user.guildId);
                const guild = guilds[user.guildId];
                
                // KV store?� Prisma 모두?�서 길드�?찾을 ???�으�??�용?�의 guildId ?�거
                if (!guild && !dbGuild) {
                    console.log(`[GET_GUILD_INFO] Guild ${user.guildId} not found, removing guildId from user ${user.id}`);
                    user.guildId = undefined;
                    await db.updateUser(user);
                    
                    // Prisma?�서??GuildMember ?�거 (?�시 ?�아?�을 ???�음)
                    const existingGuildMember = await guildRepo.getGuildMemberByUserId(user.id);
                    if (existingGuildMember) {
                        console.log(`[GET_GUILD_INFO] Removing GuildMember for user ${user.id}`);
                        await guildRepo.removeGuildMember(existingGuildMember.guildId, user.id);
                    }
                    
                    return { error: "가?�한 길드가 ?�습?�다." };
                }
                
                // KV store??길드가 ?��?�?Prisma?�는 ?�으�?기본 길드 객체 ?�성
                if (!guild && dbGuild) {
                    console.log(`[GET_GUILD_INFO] Guild ${user.guildId} exists in DB but not in KV store, creating basic guild object`);
                    
                    // DB?�서 길드 멤버 ?�보 가?�오�?
                    const dbMembers = await guildRepo.getGuildMembers(user.guildId);
                    const dbSettings = (dbGuild.settings as any) || {};
                    
                    // 기본 길드 객체 ?�성 (createDefaultGuild?� ?�사??구조)
                    const now = Date.now();
                    const basicGuild: Guild = {
                        id: dbGuild.id,
                        name: dbGuild.name, // ?�름 ?�수!
                        leaderId: dbGuild.leaderId,
                        description: dbGuild.description || undefined,
                        icon: dbGuild.emblem || '/images/guild/profile/icon1.png',
                        level: dbGuild.level,
                        gold: Number(dbGuild.gold),
                        experience: Number(dbGuild.experience),
                        xp: Number(dbGuild.experience),
                        researchPoints: 0,
                        members: dbMembers.map(m => ({
                            id: m.id,
                            guildId: m.guildId,
                            userId: m.userId,
                            nickname: '', // ?�중??채워�????�음
                            role: m.role as 'leader' | 'officer' | 'member',
                            joinDate: m.joinDate,
                            contributionTotal: m.contributionTotal,
                            weeklyContribution: 0,
                            createdAt: m.createdAt,
                            updatedAt: m.updatedAt,
                        })),
                        memberLimit: 30,
                        isPublic: dbSettings.isPublic !== undefined ? dbSettings.isPublic : true,
                        joinType: dbSettings.joinType || 'free',
                        settings: dbSettings,
                        applicants: [],
                        weeklyMissions: [],
                        lastMissionReset: now,
                        lastWeeklyContributionReset: now,
                        chatHistory: [],
                        checkIns: {},
                        dailyCheckInRewardsClaimed: [],
                        research: {},
                        researchTask: null,
                        createdAt: dbGuild.createdAt.getTime(),
                        updatedAt: dbGuild.updatedAt.getTime(),
                    };
                    
                    // KV store???�??
                    guilds[user.guildId] = basicGuild;
                    await db.setKV('guilds', guilds);
                    
                    const guildWithFixedIcon = {
                        ...basicGuild,
                        icon: basicGuild.icon?.startsWith('/images/guild/icon') 
                            ? basicGuild.icon.replace('/images/guild/icon', '/images/guild/profile/icon')
                            : (basicGuild.icon || '/images/guild/profile/icon1.png')
                    };
                    
                    return { clientResponse: { guild: guildWithFixedIcon } };
                }
                
                // members 배열???�으�?�?배열�?초기??
                if (!guild.members) {
                    guild.members = [];
                    await db.setKV('guilds', guilds);
                }
                
                // ?�이�?경로 ?�정
                const guildWithFixedIcon = {
                    ...guild,
                    members: guild.members || [],
                    icon: guild.icon?.startsWith('/images/guild/icon') 
                        ? guild.icon.replace('/images/guild/icon', '/images/guild/profile/icon')
                        : (guild.icon || '/images/guild/profile/icon1.png')
                };
                return { clientResponse: { guild: guildWithFixedIcon } };
            } catch (error: any) {
                console.error('[handleGuildAction] GET_GUILD_INFO error:', error);
                console.error('[handleGuildAction] Error stack:', error.stack);
                console.error('[handleGuildAction] User:', { id: user.id, guildId: user.guildId });
                console.error('[handleGuildAction] Guilds keys:', Object.keys(guilds));
                return { error: `길드 ?�보�?가?�오??�??�류가 발생?�습?�다: ${error.message || '?????�는 ?�류'}` };
            }
        }
        
        case 'GUILD_DELETE_CHAT_MESSAGE': {
            const { messageId, timestamp } = payload;
            if (!user.guildId) return { error: "길드??가?�되???��? ?�습?�다." };
            const guild = guilds[user.guildId];
            if (!guild) return { error: "길드�?찾을 ???�습?�다." };
            if (!guild.chatHistory) {
                return { error: "메시지�?찾을 ???�습?�다." };
            }
        
            let messageIndex = -1;
            
            // Primary method: find by ID
            if (messageId) {
                messageIndex = guild.chatHistory.findIndex(m => m.id === messageId);
            }
            
            // Fallback method for older messages without an ID on the client
            if (messageIndex === -1 && timestamp) {
                messageIndex = guild.chatHistory.findIndex(m => m.createdAt === timestamp && m.authorId === user.id);
            }
            
            if (messageIndex === -1) {
                return { error: "메시지�?찾을 ???�습?�다." };
            }
        
            const messageToDelete = guild.chatHistory[messageIndex];
            if (!guild.members) return { error: "길드 ?�보�?찾을 ???�습?�다." };
            
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const canManage = myMemberInfo?.role === GuildMemberRole.Master || myMemberInfo?.role === GuildMemberRole.Vice;
        
            if (messageToDelete.authorId !== user.id && !canManage) {
                return { error: "메시지�???��??권한???�습?�다." };
            }
        
            guild.chatHistory.splice(messageIndex, 1);
            
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            return { clientResponse: { guilds } };
        }
        
        case 'START_GUILD_BOSS_BATTLE': {
            const { bossId, result } = payload;
            if (!user.guildId) return { error: '길드에 가입되어 있지 않습니다.' };
            
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드를 찾을 수 없습니다.' };
            
            if (!guild.guildBossState) {
                guild.guildBossState = {
                    currentBossId: bossId,
                    currentBossHp: GUILD_BOSSES.find(b => b.id === bossId)?.maxHp || 1000000,
                    totalDamageLog: {},
                };
            }
            
            guild.guildBossState.currentBossHp = result.bossHpAfter;
            guild.guildBossState.totalDamageLog[user.id] = (guild.guildBossState.totalDamageLog[user.id] || 0) + result.damageDealt;

            if (!user.isAdmin) {
                user.guildBossAttempts = (user.guildBossAttempts || 0) + 1;
            }

            user.guildCoins = (user.guildCoins || 0) + result.rewards.guildCoins;
            updateQuestProgress(user, 'guild_boss_participate');
            
            const currentBoss = GUILD_BOSSES.find(b => b.id === guild.guildBossState!.currentBossId);
            if (currentBoss) {
                const chatMessage: GuildMessage = {
                    id: `msg-guild-${randomUUID()}`,
                    guildId: guild.id,
                    authorId: 'system',
                    content: `${user.nickname}이 ${currentBoss.name}에게 ${result.damageDealt}의 해를 가했습니다.`,
                    createdAt: Date.now(),
                };
                if (!guild.chatHistory) guild.chatHistory = [];
                guild.chatHistory.push(chatMessage);
                if (guild.chatHistory.length > 100) {
                    guild.chatHistory.shift();
                }
            }

            await db.setKV('guilds', guilds);
            await db.updateUser(user);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { updatedUser: user, guildBossBattleResult: result, guilds } };
        }

        
        case 'CLAIM_GUILD_WAR_REWARD': {
            if (!user.guildId) return { error: '길드에 가입되어 있지 않습니다.' };
            
            const guilds = await db.getKV<Record<string, Guild>>('guilds') || {};
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드를 찾을 수 없습니다.' };
            
            // 길드전 정보 가져오기
            const activeWars = await db.getKV<any[]>('activeGuildWars') || [];
            const completedWars = activeWars.filter(w => w.status === 'completed');
            
            // 사용자의 길드가 이긴 길드전 찾기
            const wonWar = completedWars.find(w => {
                if (w.guild1Id === user.guildId) {
                    return w.result?.winnerId === w.guild1Id;
                } else if (w.guild2Id === user.guildId) {
                    return w.result?.winnerId === w.guild2Id;
                }
                return false;
            });
            
            if (!wonWar) return { error: '받을 수 있는 보상이 없습니다.' };
            
            // 이미 받았는지 확인
            const claimedRewards = await db.getKV<Record<string, string[]>>('guildWarClaimedRewards') || {};
            if (claimedRewards[wonWar.id]?.includes(user.id)) {
                return { error: '이미 보상을 받았습니다.' };
            }
            
            // 보상 지급
            user.gold = (user.gold || 0) + 2000;
            user.guildCoins = (user.guildCoins || 0) + 300;
            
            // 랜덤 변경권 10개 생성
            const { createConsumableItemInstance } = await import('../summaryService.js');
            const ticketItems: InventoryItem[] = [];
            
            for (let i = 0; i < 10; i++) {
                const ticketRandom = Math.random();
                let ticketName: string;
                if (ticketRandom < 0.1) {
                    ticketName = '옵션 종류 변경권'; // 10%
                } else if (ticketRandom < 0.9) {
                    ticketName = '옵션 위치 변경권'; // 80%
                } else {
                    ticketName = '강화 옵션 변경권'; // 10%
                }
                
                const ticketItem = createConsumableItemInstance(ticketName);
                if (ticketItem) {
                    ticketItems.push(ticketItem);
                }
            }
            
            // 인벤토리에 추가
            const { success, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, ticketItems);
            if (!success) {
                return { error: '보상을 받기 위해 인벤토리 공간이 부족합니다.' };
            }
            
            user.inventory = updatedInventory;
            
            // 받기 기록 저장
            if (!claimedRewards[wonWar.id]) {
                claimedRewards[wonWar.id] = [];
            }
            claimedRewards[wonWar.id].push(user.id);
            await db.setKV('guildWarClaimedRewards', claimedRewards);
            
            await db.updateUser(user);
            
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['gold', 'guildCoins', 'inventory']);
            
            return { 
                clientResponse: { 
                    updatedUser: user,
                    rewardItems: ticketItems,
                    rewardGold: 2000,
                    rewardGuildCoins: 300
                } 
            };
        }

        
        default:
            console.log(`[handleGuildAction] Unknown guild action type: ${type}`);
            return { error: 'Unknown guild action type.' };
    }
};
                        }
                    })
                    .filter(g => g.isPublic !== false);
                
                filteredGuilds.sort((a, b) => {
                    if (b.level !== a.level) return b.level - a.level;
                    return a.name.localeCompare(b.name);
                });
                
                return { 
                    clientResponse: { 
                        guilds: filteredGuilds,
                        total: filteredGuilds.length
                    } 
                };
            } catch (error: any) {
                console.error('[LIST_GUILDS] Error:', error);
                return { 
                    error: error.message || '길드 목록??불러?�는???�패?�습?�다.' 
                };
            }
        }
        
                };
            }
            
            guild.guildBossState.currentBossHp = result.bossHpAfter;
            guild.guildBossState.totalDamageLog[user.id] = (guild.guildBossState.totalDamageLog[user.id] || 0) + result.damageDealt;

            if (!user.isAdmin) {
                user.guildBossAttempts = (user.guildBossAttempts || 0) + 1;
            }

            user.guildCoins = (user.guildCoins || 0) + result.rewards.guildCoins;
            updateQuestProgress(user, 'guild_boss_participate');
            
            const currentBoss = GUILD_BOSSES.find(b => b.id === guild.guildBossState!.currentBossId);
            if (currentBoss) {
                const chatMessage: GuildMessage = {
                    id: `msg-guild-${randomUUID()}`,
                    guildId: guild.id,
                    authorId: 'system',
                    content: `${user.nickname}?�이 ${currentBoss.name}?�게 ${result.damageDealt}???�해�??�혔?�니??`,
                    createdAt: Date.now(),
                };
                if (!guild.chatHistory) guild.chatHistory = [];
                guild.chatHistory.push(chatMessage);
                if (guild.chatHistory.length > 100) {
                    guild.chatHistory.shift();
                }
            }

            await db.setKV('guilds', guilds);
            await db.updateUser(user);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { updatedUser: user, guildBossBattleResult: result, guilds } };
        }

        
        case 'CLAIM_GUILD_WAR_REWARD': {
            if (!user.guildId) return { error: '길드??가?�되???��? ?�습?�다.' };
            
            const guilds = await db.getKV<Record<string, Guild>>('guilds') || {};
            const guild = guilds[user.guildId];
            if (!guild) return { error: '길드�?찾을 ???�습?�다.' };
            
            // 길드???�이??가?�오�?
            const activeWars = await db.getKV<any[]>('activeGuildWars') || [];
            const completedWars = activeWars.filter(w => w.status === 'completed');
            
            // ?�용?�의 길드가 ?�리??길드??찾기
            const wonWar = completedWars.find(w => {
                if (w.guild1Id === user.guildId) {
                    return w.result?.winnerId === w.guild1Id;
                } else if (w.guild2Id === user.guildId) {
                    return w.result?.winnerId === w.guild2Id;
                }
                return false;
            });
            
            if (!wonWar) return { error: '?�령?????�는 보상???�습?�다.' };
            
            // ?��? ?�령?�는지 ?�인
            const claimedRewards = await db.getKV<Record<string, string[]>>('guildWarClaimedRewards') || {};
            if (claimedRewards[wonWar.id]?.includes(user.id)) {
                return { error: '?��? 보상???�령?�습?�다.' };
            }
            
            // 보상 지�?
            user.gold = (user.gold || 0) + 2000;
            user.guildCoins = (user.guildCoins || 0) + 300;
            
            // ?�덤 변경권 10???�성
            const { createConsumableItemInstance } = await import('../summaryService.js');
            const ticketItems: InventoryItem[] = [];
            
            for (let i = 0; i < 10; i++) {
                const ticketRandom = Math.random();
                let ticketName: string;
                if (ticketRandom < 0.1) {
                    ticketName = '?�션 종류 변경권'; // 10%
                } else if (ticketRandom < 0.9) {
                    ticketName = '?�션 ?�치 변경권'; // 80%
                } else {
                    ticketName = '?�화 ?�션 변경권'; // 10%
                }
                
                const ticketItem = createConsumableItemInstance(ticketName);
                if (ticketItem) {
                    ticketItems.push(ticketItem);
                }
            }
            
            // ?�벤?�리??추�?
            const { success, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, ticketItems);
            if (!success) {
                return { error: '보상??받기???�벤?�리 공간??부족합?�다.' };
            }
            
            user.inventory = updatedInventory;
            
            // ?�령 기록 ?�??
            if (!claimedRewards[wonWar.id]) {
                claimedRewards[wonWar.id] = [];
            }
            claimedRewards[wonWar.id].push(user.id);
            await db.setKV('guildWarClaimedRewards', claimedRewards);
            
            await db.updateUser(user);
            
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['gold', 'guildCoins', 'inventory']);
            
            return { 
                clientResponse: { 
                    updatedUser: user,
                    rewardItems: ticketItems,
                    rewardGold: 2000,
                    rewardGuildCoins: 300
                } 
            };
        }
        
        default:
            console.log(`[handleGuildAction] Unknown guild action type: ${type}`);
            return { error: 'Unknown guild action type.' };
    }
};
