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
            const { name, description, isPublic } = payload;
            
            // Validate name
            if (!name || typeof name !== 'string') {
                return { error: 'ê¸¸ë“œ ?´ë¦„???…ë ¥?´ì£¼?¸ìš”.' };
            }
            const trimmedName = name.trim();
            if (trimmedName.length < 2 || trimmedName.length > 6) {
                return { error: 'ê¸¸ë“œ ?´ë¦„?€ 2???´ìƒ 6???´í•˜?¬ì•¼ ?©ë‹ˆ??' };
            }
            
            // Validate description if provided
            const trimmedDescription = description ? String(description).trim() : '';
            if (trimmedDescription && trimmedDescription.length > 200) {
                return { error: 'ê¸¸ë“œ ?¤ëª…?€ 200???´í•˜?¬ì•¼ ?©ë‹ˆ??' };
            }
            
            // Check for profanity
            if (containsProfanity(trimmedName) || (trimmedDescription && containsProfanity(trimmedDescription))) {
                return { error: 'ë¶€?ì ˆ???¨ì–´ê°€ ?¬í•¨?˜ì–´ ?ˆìŠµ?ˆë‹¤.' };
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
                    // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
                    db.updateUser(user).catch(err => {
                        console.error(`[CREATE_GUILD] Failed to clear guildId for user ${user.id}:`, err);
                    });
                }
            } else {
                // For non-admin users, check if already in a guild
                const existingGuildMember = await guildRepo.getGuildMemberByUserId(user.id);
                if (existingGuildMember || user.guildId) {
                    return { error: '?´ë? ê¸¸ë“œ??ê°€?…ë˜???ˆìŠµ?ˆë‹¤.' };
                }
            }
            
            if (!user.isAdmin) {
                // ?¤ì´?„ëª¬???€??ë³€??(BigInt?????ˆìŒ)
                const userDiamonds = typeof user.diamonds === 'bigint' ? Number(user.diamonds) : (user.diamonds || 0);
                if (userDiamonds < GUILD_CREATION_COST) {
                    return { error: `?¤ì´?„ê? ë¶€ì¡±í•©?ˆë‹¤. (?„ìš”: ${GUILD_CREATION_COST}ê°? ë³´ìœ : ${userDiamonds}ê°?` };
                }
                currencyService.spendDiamonds(user, GUILD_CREATION_COST, 'ê¸¸ë“œ ì°½ì„¤');
            }
            
            // Check for duplicate name using Prisma (to ensure consistency with delete operations)
            const existingGuild = await guildRepo.getGuildByName(trimmedName);
            if (existingGuild) {
                return { error: '?´ë? ?¬ìš© ì¤‘ì¸ ê¸¸ë“œ ?´ë¦„?…ë‹ˆ??' };
            }

            const guildId = `guild-${globalThis.crypto.randomUUID()}`;
            const newGuild = createDefaultGuild(guildId, trimmedName, trimmedDescription || undefined, isPublic, user);
            
            // ì¤‘ê°„???ì„±??ê¸¸ë“œ???¤ìŒ ë§¤ì¹­(?”ìš”???ëŠ” ê¸ˆìš”????ì°¸ì—¬
            const { getKSTDay, getStartOfDayKST } = await import('../../utils/timeUtils.js');
            const now = Date.now();
            const kstDay = getKSTDay(now);
            const todayStart = getStartOfDayKST(now);
            
            // ?¤ìŒ ë§¤ì¹­ ? ì§œ ê³„ì‚°
            let daysUntilNext = 0;
            if (kstDay === 1) {
                // ?”ìš”??- ê¸ˆìš”?¼ê¹Œì§€ (4????
                daysUntilNext = 4;
            } else if (kstDay === 2 || kstDay === 3) {
                // ?”ìš”?? ?˜ìš”??- ê¸ˆìš”?¼ê¹Œì§€
                daysUntilNext = 5 - kstDay;
            } else if (kstDay === 4) {
                // ëª©ìš”??- ?¤ìŒ ?”ìš”?¼ê¹Œì§€ (3????
                daysUntilNext = 3;
            } else if (kstDay === 5) {
                // ê¸ˆìš”??- ?¤ìŒ ?”ìš”?¼ê¹Œì§€ (3????
                daysUntilNext = 3;
            } else {
                // ? ìš”?? ?¼ìš”??- ?¤ìŒ ?”ìš”?¼ê¹Œì§€
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
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[CREATE_GUILD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildId', 'diamonds']);
            
            return { clientResponse: { guild: newGuild, updatedUser: user } };
        }
        
        case 'JOIN_GUILD': {
            const { guildId } = payload;
            const guild = guilds[guildId];

            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            if (user.guildId) return { error: '?´ë? ê¸¸ë“œ??ê°€?…ë˜???ˆìŠµ?ˆë‹¤.' };
            if (!guild.members) guild.members = [];
            if (guild.members.length >= (guild.memberLimit || 30)) return { error: 'ê¸¸ë“œ ?¸ì›??ê°€??ì°¼ìŠµ?ˆë‹¤.' };

            // joinType???°ë¼ ê°€??ë°©ì‹ ê²°ì •
            const joinType = guild.joinType || 'application'; // ê¸°ë³¸ê°’ì? ? ì²­ê°€??
            const isApplicationPending = guild.applicants?.some((app: any) => 
                (typeof app === 'string' ? app : app.userId) === user.id
            );

            if (joinType === 'free') {
                // ?ìœ ê°€?? ë¹ˆìë¦¬ê? ?ˆìœ¼ë©??ë™ ê°€??
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
                // ê¸°ì¡´ ? ì²­???ˆìœ¼ë©??œê±°
                if (guild.applicants) {
                    guild.applicants = guild.applicants.filter((app: any) => 
                        (typeof app === 'string' ? app : app.userId) !== user.id
                    );
                }
                if (user.guildApplications) {
                    user.guildApplications = user.guildApplications.filter(app => app.guildId !== guildId);
                }
            } else {
                // ? ì²­ê°€?? ê¸¸ë“œ??ë¶€ê¸¸ë“œ???¹ì¸ ?„ìš”
                if (isApplicationPending) return { error: '?´ë? ê°€??? ì²­???ˆìŠµ?ˆë‹¤.' };
                if (!guild.applicants) guild.applicants = [];
                guild.applicants.push({ userId: user.id, appliedAt: Date.now() });
                if (!user.guildApplications) user.guildApplications = [];
                user.guildApplications.push({ guildId: guild.id, appliedAt: Date.now() });
            }

            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[JOIN_GUILD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildId', 'guildApplications']);
            
            return { clientResponse: { updatedUser: user } };
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
                    // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
                    db.updateUser(user).catch(err => {
                        console.error(`[GUILD_CANCEL_APPLICATION] Failed to save user ${user.id}:`, err);
                    });

                    // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
                    const { broadcastUserUpdate } = await import('../socket.js');
                    broadcastUserUpdate(user, ['guildApplications']);
                }
            return { clientResponse: { updatedUser: user } };
        }
        
        case 'GUILD_ACCEPT_APPLICANT': {
            const { guildId, applicantId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            if (!myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
            }
            if (guild.members.length >= (guild.memberLimit || 30)) return { error: 'ê¸¸ë“œ ?¸ì›??ê°€??ì°¼ìŠµ?ˆë‹¤.' };

            const applicant = await db.getUser(applicantId);
            if (!applicant || applicant.guildId) {
                if (guild.applicants) {
                    guild.applicants = guild.applicants.filter((app: any) => 
                        (typeof app === 'string' ? app : app.userId) !== applicantId
                    );
                }
                await db.setKV('guilds', guilds);
                return { error: '?€?ì´ ?´ë? ?¤ë¥¸ ê¸¸ë“œ??ê°€?…í–ˆ?µë‹ˆ??' };
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
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(applicant).catch(err => {
                console.error(`[GUILD_ACCEPT_APPLICANT] Failed to save applicant ${applicant.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(applicant, ['guildId', 'guildApplications']);
            
            return { clientResponse: { guilds } };
        }

        case 'GUILD_REJECT_APPLICANT': {
            const { guildId, applicantId } = payload;
            const guild = guilds[guildId];
            const myMemberInfo = guild?.members.find(m => m.userId === user.id);
             if (!guild || !myMemberInfo || (myMemberInfo.role !== GuildMemberRole.Master && myMemberInfo.role !== GuildMemberRole.Vice)) {
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
            }
            if (guild.applicants) {
                guild.applicants = guild.applicants.filter((app: any) => 
                    (typeof app === 'string' ? app : app.userId) !== applicantId
                );
            }
            
            const applicant = await db.getUser(applicantId);
            if (applicant && applicant.guildApplications) {
                applicant.guildApplications = applicant.guildApplications.filter(app => app.guildId !== guildId);
                
                // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
                db.updateUser(applicant).catch(err => {
                    console.error(`[GUILD_REJECT_APPLICANT] Failed to save applicant ${applicant.id}:`, err);
                });

                // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
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
            if (!guild || user.guildId !== guildId) return { error: 'ê¸¸ë“œ ?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            
            const memberInfo = guild.members.find(m => m.userId === user.id);
            if (!memberInfo) return { error: 'ê¸¸ë“œ?ì´ ?„ë‹™?ˆë‹¤.' };
            if (memberInfo.role === GuildMemberRole.Master && guild.members.length > 1) {
                return { error: 'ê¸¸ë“œ?¥ì´ ê¸¸ë“œë¥?? ë‚˜?¤ë©´ ë¨¼ì? ?¤ë¥¸ ê¸¸ë“œ?ì—ê²?ê¸¸ë“œ?¥ì„ ?„ì„?´ì•¼ ?©ë‹ˆ??' };
            }
            
            if (memberInfo.role === GuildMemberRole.Master && guild.members.length === 1) {
                delete guilds[guildId]; // Last member, dissolve guild
            } else {
                guild.members = guild.members.filter(m => m.userId !== user.id);
            }
            
            user.guildId = null;
            await db.setKV('guilds', guilds);
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[GUILD_LEAVE] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildId']);
            
            return { clientResponse: { updatedUser: user, guilds } };
        }

        case 'GUILD_KICK_MEMBER': {
            const { guildId, targetMemberId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const targetMemberInfo = guild.members.find(m => m.userId === targetMemberId);

            if (!myMemberInfo || !targetMemberInfo) return { error: '?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            if ((myMemberInfo.role === GuildMemberRole.Master && targetMemberInfo.role !== GuildMemberRole.Master) || 
                (myMemberInfo.role === GuildMemberRole.Vice && targetMemberInfo.role === GuildMemberRole.Member)) {
                
                guild.members = guild.members.filter(m => m.userId !== targetMemberId);
                const targetUser = await db.getUser(targetMemberId);
                if (targetUser) {
                    targetUser.guildId = undefined;
                    
                    // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
                    db.updateUser(targetUser).catch(err => {
                        console.error(`[GUILD_KICK_MEMBER] Failed to save target user ${targetUser.id}:`, err);
                    });

                    // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
                    const { broadcastUserUpdate } = await import('../socket.js');
                    broadcastUserUpdate(targetUser, ['guildId']);
                }
                await db.setKV('guilds', guilds);
                await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            } else {
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
            }
            return { clientResponse: { guilds } };
        }
        
        case 'GUILD_PROMOTE_MEMBER':
        case 'GUILD_DEMOTE_MEMBER': {
             const { guildId, targetMemberId } = payload;
            const guild = guilds[guildId];
            if (!guild || !guild.members) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const targetMemberInfo = guild.members.find(m => m.userId === targetMemberId);
            if (!myMemberInfo || !targetMemberInfo || myMemberInfo.role !== GuildMemberRole.Master) {
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
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
            if (!guild || !guild.members) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const targetMemberInfo = guild.members.find(m => m.userId === targetMemberId);

            if (!myMemberInfo || !targetMemberInfo || myMemberInfo.role !== GuildMemberRole.Master) {
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
            }
            if (myMemberInfo.userId === targetMemberId) {
                return { error: '?ê¸° ?ì‹ ?ê²Œ ?„ì„?????†ìŠµ?ˆë‹¤.' };
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
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
            }
            if(description !== undefined) guild.description = description;
            if(isPublic !== undefined) guild.isPublic = isPublic;
            if(joinType !== undefined) guild.joinType = joinType;
            if(icon !== undefined) {
                guild.icon = icon;
                // DB?ë„ ?…ë°?´íŠ¸ (emblem ?„ë“œ)
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
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
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
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };

            if (!guild.checkIns) guild.checkIns = {};
            if (isSameDayKST(guild.checkIns[user.id], now)) return { error: '?¤ëŠ˜ ?´ë? ì¶œì„?ˆìŠµ?ˆë‹¤.' };

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
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            
            const now = Date.now();
            const todaysCheckIns = Object.values(guild.checkIns || {}).filter(ts => isSameDayKST(ts, now)).length;
            const milestone = GUILD_CHECK_IN_MILESTONE_REWARDS[milestoneIndex];

            if (!milestone || todaysCheckIns < milestone.count) return { error: 'ë³´ìƒ ì¡°ê±´??ë§Œì¡±?˜ì? ëª»í–ˆ?µë‹ˆ??' };
            if (!guild.dailyCheckInRewardsClaimed) guild.dailyCheckInRewardsClaimed = [];
            if (guild.dailyCheckInRewardsClaimed.some(c => c.userId === user.id && c.milestoneIndex === milestoneIndex)) return { error: '?´ë? ?˜ë ¹??ë³´ìƒ?…ë‹ˆ??' };
            
            user.guildCoins = (user.guildCoins || 0) + milestone.reward.guildCoins;
            guild.dailyCheckInRewardsClaimed.push({ userId: user.id, milestoneIndex });

            await db.setKV('guilds', guilds);
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[GUILD_CLAIM_CHECK_IN_REWARD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildCoins']);
            
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { updatedUser: user, guilds } };
        }
        case 'GUILD_CLAIM_MISSION_REWARD': {
            const { missionId } = payload;
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
        
            const mission = guild.weeklyMissions.find(m => m.id === missionId);
        
            if (!mission) return { error: 'ë¯¸ì…˜??ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            if (!mission.isCompleted) return { error: '?„ì§ ?„ë£Œ?˜ì? ?Šì? ë¯¸ì…˜?…ë‹ˆ??' };
            if (mission.claimedBy.includes(user.id)) return { error: '?´ë? ?˜ë ¹??ë³´ìƒ?…ë‹ˆ??' };
            
            // ì´ˆê¸°????ì§€??ë³´ìƒ?€ ë°›ì„ ???†ë„ë¡?ì²´í¬
            const now = Date.now();
            if (guild.lastMissionReset && isDifferentWeekKST(guild.lastMissionReset, now)) {
                return { error: '?´ë? ì´ˆê¸°?”ëœ ë¯¸ì…˜?´ë?ë¡?ë³´ìƒ??ë°›ì„ ???†ìŠµ?ˆë‹¤.' };
            }

            // XP??ë¯¸ì…˜ ?„ë£Œ ???´ë? ì¶”ê??˜ì—ˆ?¼ë?ë¡??¬ê¸°?œëŠ” ê°œì¸ ë³´ìƒë§?ì§€ê¸?
            // Grant personal reward (Guild Coins)
            user.guildCoins = (user.guildCoins || 0) + mission.personalReward.guildCoins;
        
            // Mark as claimed by the current user
            mission.claimedBy.push(user.id);
            
            await db.setKV('guilds', guilds);
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[GUILD_CLAIM_MISSION_REWARD] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['guildCoins']);
            
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            return { clientResponse: { updatedUser: user, guilds } };
        }
        case 'GUILD_DONATE_GOLD':
        case 'GUILD_DONATE_DIAMOND': {
            console.log(`[handleGuildAction] Processing ${type} for user ${user.id}, guildId: ${user.guildId}`);
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            
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
                    if (user.dailyDonations!.gold >= GUILD_DONATION_GOLD_LIMIT) return { error: '?¤ëŠ˜ ê³¨ë“œ ê¸°ë? ?œë„ë¥?ì´ˆê³¼?ˆìŠµ?ˆë‹¤.' };
                    if (user.gold < GUILD_DONATION_GOLD_COST) return { error: 'ê³¨ë“œê°€ ë¶€ì¡±í•©?ˆë‹¤.' };
                    currencyService.spendGold(user, GUILD_DONATION_GOLD_COST, 'ê¸¸ë“œ ê¸°ë?');
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
                    if (user.dailyDonations!.diamond >= GUILD_DONATION_DIAMOND_LIMIT) return { error: '?¤ëŠ˜ ?¤ì´??ê¸°ë? ?œë„ë¥?ì´ˆê³¼?ˆìŠµ?ˆë‹¤.' };
                    if (user.diamonds < GUILD_DONATION_DIAMOND_COST) return { error: '?¤ì´?„ê? ë¶€ì¡±í•©?ˆë‹¤.' };
                    currencyService.spendDiamonds(user, GUILD_DONATION_DIAMOND_COST, 'ê¸¸ë“œ ê¸°ë?');
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
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[${type}] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            const { getSelectiveUserUpdate } = await import('../utils/userUpdateHelper.js');
            const changedFields = type === 'GUILD_DONATE_GOLD' 
                ? ['gold', 'guildCoins', 'dailyDonations'] 
                : ['diamonds', 'guildCoins', 'dailyDonations'];
            broadcastUserUpdate(user, changedFields);
            
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } });
            console.log(`[handleGuildAction] ${type} completed successfully`);
            
            // updatedUser??guildCoins?€ dailyDonationsê°€ ?¬í•¨?˜ë„ë¡?ë³´ì¥
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
                return { error: 'ê¶Œí•œ???†ìŠµ?ˆë‹¤.' };
            }
            if (guild.researchTask) return { error: '?´ë? ì§„í–‰ ì¤‘ì¸ ?°êµ¬ê°€ ?ˆìŠµ?ˆë‹¤.' };

            const project = GUILD_RESEARCH_PROJECTS[researchId as keyof typeof GUILD_RESEARCH_PROJECTS];
            const currentLevel = guild.research?.[researchId as keyof typeof GUILD_RESEARCH_PROJECTS]?.level ?? 0;
            if (currentLevel >= project.maxLevel) return { error: 'ìµœê³  ?ˆë²¨???„ë‹¬?ˆìŠµ?ˆë‹¤.' };
            
            const cost = getResearchCost(researchId, currentLevel);
            const timeMs = getResearchTimeMs(researchId, currentLevel);
            if (guild.researchPoints < cost) return { error: '?°êµ¬ ?¬ì¸?¸ê? ë¶€ì¡±í•©?ˆë‹¤.' };
            
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
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };

            const itemToBuy = GUILD_SHOP_ITEMS.find(item => item.itemId === itemId);
            if (!itemToBuy) return { error: '?ì ?ì„œ ?´ë‹¹ ?„ì´?œì„ ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            
            if (!user.isAdmin) {
                // Check cost
                if ((user.guildCoins || 0) < itemToBuy.cost) {
                    return { error: 'ê¸¸ë“œ ì½”ì¸??ë¶€ì¡±í•©?ˆë‹¤.' };
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
                    return { error: `${itemToBuy.limitType === 'weekly' ? 'ì£¼ê°„' : '?”ê°„'} êµ¬ë§¤ ?œë„ë¥?ì´ˆê³¼?ˆìŠµ?ˆë‹¤.` };
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
            if (itemToBuy.itemId === 'ë³´ë„ˆ???¤íƒ¯ +5') {
                user.bonusStatPoints = (user.bonusStatPoints || 0) + 5;
                
                // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
                db.updateUser(user).catch(err => {
                    console.error(`[BUY_GUILD_SHOP_ITEM] Failed to save user ${user.id}:`, err);
                });

                // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(user, ['bonusStatPoints', 'guildCoins']);
                
                const rewardSummary = {
                    reward: { bonus: '?¤íƒ¯+5' },
                    items: [],
                    title: 'ê¸¸ë“œ ?ì  êµ¬ë§¤'
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
                     return { error: '?„ì´???•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
                }
            }
            
            const { success } = addItemsToInventory(user.inventory, user.inventorySlots, itemsToAdd);
            if (!success) {
                if (!user.isAdmin) { user.guildCoins = (user.guildCoins || 0) + itemToBuy.cost; } // Refund
                return { error: '?¸ë²¤? ë¦¬ ê³µê°„??ë¶€ì¡±í•©?ˆë‹¤.' };
            }
            
            // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
            db.updateUser(user).catch(err => {
                console.error(`[BUY_GUILD_SHOP_ITEM] Failed to save user ${user.id}:`, err);
            });

            // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
            const { broadcastUserUpdate } = await import('../socket.js');
            broadcastUserUpdate(user, ['inventory', 'guildCoins']);
            
            return { clientResponse: { updatedUser: user, obtainedItemsBulk: itemsToAdd } };
        }

        case 'BUY_GUILD_SHOP_ITEM': {
            const { itemId, quantity } = payload;
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };

            const itemToBuy = GUILD_SHOP_ITEMS.find(item => item.itemId === itemId);
            if (!itemToBuy) return { error: '?ì ?ì„œ ?´ë‹¹ ?„ì´?œì„ ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };

            const totalCost = itemToBuy.cost * quantity;
            if ((user.guildCoins || 0) < totalCost) {
                return { error: 'ê¸¸ë“œ ì½”ì¸??ë¶€ì¡±í•©?ˆë‹¤.' };
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
                return { error: `${itemToBuy.limitType === 'weekly' ? 'ì£¼ê°„' : '?”ê°„'} êµ¬ë§¤ ?œë„ë¥?ì´ˆê³¼?ˆìŠµ?ˆë‹¤.` };
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
                        return { error: '?„ì´???•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
                    }
                }
            }

            const { success } = addItemsToInventory(user.inventory, user.inventorySlots, itemsToAdd);
            if (!success) {
                user.guildCoins = (user.guildCoins || 0) + totalCost; // Refund
                return { error: '?¸ë²¤? ë¦¬ ê³µê°„??ë¶€ì¡±í•©?ˆë‹¤.' };
            }

                // DB ?…ë°?´íŠ¸ë¥?ë¹„ë™ê¸°ë¡œ ì²˜ë¦¬ (?‘ë‹µ ì§€??ìµœì†Œ??
                db.updateUser(user).catch(err => {
                    console.error(`[BUY_GUILD_SHOP_ITEM] Failed to save user ${user.id}:`, err);
                });

                // WebSocket?¼ë¡œ ?¬ìš©???…ë°?´íŠ¸ ë¸Œë¡œ?œìº?¤íŠ¸ (ìµœì ?”ëœ ?¨ìˆ˜ ?¬ìš©)
                const { broadcastUserUpdate } = await import('../socket.js');
                broadcastUserUpdate(user, ['inventory', 'guildCoins']);
                
            await broadcast({ type: 'GUILD_UPDATE', payload: { guilds } }); // Broadcast guilds

            return { clientResponse: { updatedUser: user, obtainedItemsBulk: itemsToAdd } };
        }

        case 'GET_GUILD_WAR_DATA': {
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            
            const guilds = await db.getKV<Record<string, Guild>>('guilds') || {};
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            
            // ê¸¸ë“œ???°ì´??ê°€?¸ì˜¤ê¸?
            const activeWars = await db.getKV<any[]>('activeGuildWars') || [];
            const activeWar = activeWars.find(w => 
                (w.guild1Id === user.guildId || w.guild2Id === user.guildId) && 
                w.status === 'active'
            );
            
            // ?¤ìŒ ë§¤ì¹­ ? ì§œ ê°€?¸ì˜¤ê¸?(ê¸¸ë“œ???¤ì •?˜ì–´ ?ˆìœ¼ë©??¬ìš©, ?†ìœ¼ë©?ê³„ì‚°)
            let nextMatchDate = (guild as any).nextWarMatchDate;
            if (!nextMatchDate) {
                // ?¤ìŒ ë§¤ì¹­ ? ì§œ ê³„ì‚°
                const { getKSTDay, getStartOfDayKST } = await import('../../utils/timeUtils.js');
                const now = Date.now();
                const kstDay = getKSTDay(now);
                const todayStart = getStartOfDayKST(now);
                
                let daysUntilNext = 0;
                if (kstDay === 1) {
                    daysUntilNext = 4; // ?”ìš”??- ê¸ˆìš”?¼ê¹Œì§€
                } else if (kstDay === 2 || kstDay === 3) {
                    daysUntilNext = 5 - kstDay; // ?”ìš”?? ?˜ìš”??- ê¸ˆìš”?¼ê¹Œì§€
                } else if (kstDay === 4) {
                    daysUntilNext = 3; // ëª©ìš”??- ?¤ìŒ ?”ìš”?¼ê¹Œì§€
                } else if (kstDay === 5) {
                    daysUntilNext = 3; // ê¸ˆìš”??- ?¤ìŒ ?”ìš”?¼ê¹Œì§€
                } else {
                    daysUntilNext = (8 - kstDay) % 7; // ? ìš”?? ?¼ìš”??- ?¤ìŒ ?”ìš”?¼ê¹Œì§€
                }
                
                nextMatchDate = todayStart + (daysUntilNext * 24 * 60 * 60 * 1000);
            }
            
            return { clientResponse: { activeWar, guilds, nextMatchDate } };
        }
        
        case 'GET_GUILD_INFO': {
            try {
                if (!user.guildId) return { error: "ê°€?…í•œ ê¸¸ë“œê°€ ?†ìŠµ?ˆë‹¤." };
                
                // Prisma?ì„œ??ê¸¸ë“œ ì¡´ì¬ ?¬ë? ?•ì¸
                const dbGuild = await guildRepo.getGuildById(user.guildId);
                const guild = guilds[user.guildId];
                
                // KV store?€ Prisma ëª¨ë‘?ì„œ ê¸¸ë“œë¥?ì°¾ì„ ???†ìœ¼ë©??¬ìš©?ì˜ guildId ?œê±°
                if (!guild && !dbGuild) {
                    console.log(`[GET_GUILD_INFO] Guild ${user.guildId} not found, removing guildId from user ${user.id}`);
                    user.guildId = undefined;
                    await db.updateUser(user);
                    
                    // Prisma?ì„œ??GuildMember ?œê±° (?¹ì‹œ ?¨ì•„?ˆì„ ???ˆìŒ)
                    const existingGuildMember = await guildRepo.getGuildMemberByUserId(user.id);
                    if (existingGuildMember) {
                        console.log(`[GET_GUILD_INFO] Removing GuildMember for user ${user.id}`);
                        await guildRepo.removeGuildMember(existingGuildMember.guildId, user.id);
                    }
                    
                    return { error: "ê°€?…í•œ ê¸¸ë“œê°€ ?†ìŠµ?ˆë‹¤." };
                }
                
                // KV store??ê¸¸ë“œê°€ ?†ì?ë§?Prisma?ëŠ” ?ˆìœ¼ë©?ê¸°ë³¸ ê¸¸ë“œ ê°ì²´ ?ì„±
                if (!guild && dbGuild) {
                    console.log(`[GET_GUILD_INFO] Guild ${user.guildId} exists in DB but not in KV store, creating basic guild object`);
                    
                    // DB?ì„œ ê¸¸ë“œ ë©¤ë²„ ?•ë³´ ê°€?¸ì˜¤ê¸?
                    const dbMembers = await guildRepo.getGuildMembers(user.guildId);
                    const dbSettings = (dbGuild.settings as any) || {};
                    
                    // ê¸°ë³¸ ê¸¸ë“œ ê°ì²´ ?ì„± (createDefaultGuild?€ ? ì‚¬??êµ¬ì¡°)
                    const now = Date.now();
                    const basicGuild: Guild = {
                        id: dbGuild.id,
                        name: dbGuild.name, // ?´ë¦„ ?„ìˆ˜!
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
                            nickname: '', // ?˜ì¤‘??ì±„ì›Œì§????ˆìŒ
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
                    
                    // KV store???€??
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
                
                // members ë°°ì—´???†ìœ¼ë©?ë¹?ë°°ì—´ë¡?ì´ˆê¸°??
                if (!guild.members) {
                    guild.members = [];
                    await db.setKV('guilds', guilds);
                }
                
                // ?„ì´ì½?ê²½ë¡œ ?˜ì •
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
                return { error: `ê¸¸ë“œ ?•ë³´ë¥?ê°€?¸ì˜¤??ì¤??¤ë¥˜ê°€ ë°œìƒ?ˆìŠµ?ˆë‹¤: ${error.message || '?????†ëŠ” ?¤ë¥˜'}` };
            }
        }
        
        case 'GUILD_DELETE_CHAT_MESSAGE': {
            const { messageId, timestamp } = payload;
            if (!user.guildId) return { error: "ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤." };
            const guild = guilds[user.guildId];
            if (!guild) return { error: "ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤." };
            if (!guild.chatHistory) {
                return { error: "ë©”ì‹œì§€ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤." };
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
                return { error: "ë©”ì‹œì§€ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤." };
            }
        
            const messageToDelete = guild.chatHistory[messageIndex];
            if (!guild.members) return { error: "ê¸¸ë“œ ?•ë³´ë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤." };
            
            const myMemberInfo = guild.members.find(m => m.userId === user.id);
            const canManage = myMemberInfo?.role === GuildMemberRole.Master || myMemberInfo?.role === GuildMemberRole.Vice;
        
            if (messageToDelete.authorId !== user.id && !canManage) {
                return { error: "ë©”ì‹œì§€ë¥??? œ??ê¶Œí•œ???†ìŠµ?ˆë‹¤." };
            }
        
            guild.chatHistory.splice(messageIndex, 1);
                        } else {
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
                    error: error.message || 'ê¸¸ë“œ ëª©ë¡??ë¶ˆëŸ¬?¤ëŠ”???¤íŒ¨?ˆìŠµ?ˆë‹¤.' 
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
                    content: `${user.nickname}?˜ì´ ${currentBoss.name}?ê²Œ ${result.damageDealt}???¼í•´ë¥??…í˜”?µë‹ˆ??`,
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
            if (!user.guildId) return { error: 'ê¸¸ë“œ??ê°€?…ë˜???ˆì? ?ŠìŠµ?ˆë‹¤.' };
            
            const guilds = await db.getKV<Record<string, Guild>>('guilds') || {};
            const guild = guilds[user.guildId];
            if (!guild) return { error: 'ê¸¸ë“œë¥?ì°¾ì„ ???†ìŠµ?ˆë‹¤.' };
            
            // ê¸¸ë“œ???°ì´??ê°€?¸ì˜¤ê¸?
            const activeWars = await db.getKV<any[]>('activeGuildWars') || [];
            const completedWars = activeWars.filter(w => w.status === 'completed');
            
            // ?¬ìš©?ì˜ ê¸¸ë“œê°€ ?¹ë¦¬??ê¸¸ë“œ??ì°¾ê¸°
            const wonWar = completedWars.find(w => {
                if (w.guild1Id === user.guildId) {
                    return w.result?.winnerId === w.guild1Id;
                } else if (w.guild2Id === user.guildId) {
                    return w.result?.winnerId === w.guild2Id;
                }
                return false;
            });
            
            if (!wonWar) return { error: '?˜ë ¹?????ˆëŠ” ë³´ìƒ???†ìŠµ?ˆë‹¤.' };
            
            // ?´ë? ?˜ë ¹?ˆëŠ”ì§€ ?•ì¸
            const claimedRewards = await db.getKV<Record<string, string[]>>('guildWarClaimedRewards') || {};
            if (claimedRewards[wonWar.id]?.includes(user.id)) {
                return { error: '?´ë? ë³´ìƒ???˜ë ¹?ˆìŠµ?ˆë‹¤.' };
            }
            
            // ë³´ìƒ ì§€ê¸?
            user.gold = (user.gold || 0) + 2000;
            user.guildCoins = (user.guildCoins || 0) + 300;
            
            // ?œë¤ ë³€ê²½ê¶Œ 10???ì„±
            const { createConsumableItemInstance } = await import('../summaryService.js');
            const ticketItems: InventoryItem[] = [];
            
            for (let i = 0; i < 10; i++) {
                const ticketRandom = Math.random();
                let ticketName: string;
                if (ticketRandom < 0.1) {
                    ticketName = '?µì…˜ ì¢…ë¥˜ ë³€ê²½ê¶Œ'; // 10%
                } else if (ticketRandom < 0.9) {
                    ticketName = '?µì…˜ ?˜ì¹˜ ë³€ê²½ê¶Œ'; // 80%
                } else {
                    ticketName = '? í™” ?µì…˜ ë³€ê²½ê¶Œ'; // 10%
                }
                
                const ticketItem = createConsumableItemInstance(ticketName);
                if (ticketItem) {
                    ticketItems.push(ticketItem);
                }
            }
            
            // ?¸ë²¤? ë¦¬??ì¶”ê?
            const { success, updatedInventory } = addItemsToInventory(user.inventory, user.inventorySlots, ticketItems);
            if (!success) {
                return { error: 'ë³´ìƒ??ë°›ê¸°???¸ë²¤? ë¦¬ ê³µê°„??ë¶€ì¡±í•©?ˆë‹¤.' };
            }
            
            user.inventory = updatedInventory;
            
            // ?˜ë ¹ ê¸°ë¡ ?€??
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
