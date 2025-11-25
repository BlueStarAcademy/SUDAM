
// utils/guildBossSimulator.ts
// FIX: Split type and value imports to resolve namespace collision errors
// FIX: Changed imports to point to specific files to avoid namespace conflicts
import type { User, Guild, GuildBossInfo, QuestReward, MannerEffects, GuildBossSkill, GuildBossActiveSkill, GuildBossPassiveSkill, GuildBossSkillEffect, GuildBossSkillSubEffect, BattleLogEntry, GuildBossBattleResult } from '../types/index.js';
import { GuildResearchId, CoreStat, SpecialStat, MythicStat } from '../types/enums.js';
import { GUILD_BOSSES, GUILD_RESEARCH_PROJECTS, ACTION_POINT_REGEN_INTERVAL_MS } from '../constants/index.js';
import { BOSS_SKILL_ICON_MAP, GUILD_RESEARCH_IGNITE_IMG, GUILD_RESEARCH_HEAL_BLOCK_IMG, GUILD_RESEARCH_REGEN_IMG, GUILD_ATTACK_ICON } from '../assets.js';
import { calculateUserEffects, calculateTotalStats } from './statUtils.js';
import { getMannerEffects } from './mannerUtils.js';


// FIX: Removed local type definitions, now imported from types/index.js

const normalAttackCommentaries = ['침착한 한수로 응수합니다.', '정확하게 약점을 노립니다.', '흐름을 가져오는 일격입니다.', '단단하게 지켜냅니다.'];
const criticalAttackCommentaries = ['사활문제를 풀어냈습니다!', '엄청난 집중력으로 좋은 한수를 둡니다.', '예리한 묘수로 허를 찌릅니다!', '신의 한수!'];

const getRandom = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

export const runGuildBossBattle = (user: User, guild: Guild, boss: GuildBossInfo): GuildBossBattleResult => {
    const totalStats = calculateTotalStats(user, guild);
    const effects = calculateUserEffects(user, guild);
    const BATTLE_TURNS = 30; // Boss will use finisher on turn 30
    
    let userHp = 20000 + (totalStats[CoreStat.Concentration] * 10);
    const hpIncreaseLevel = guild.research?.boss_hp_increase?.level || 0;
    if (hpIncreaseLevel > 0) userHp *= (1 + (GUILD_RESEARCH_PROJECTS[GuildResearchId.boss_hp_increase].baseEffect * hpIncreaseLevel) / 100);
    userHp = Math.round(userHp);
    const maxUserHp = userHp;

    let totalDamageDealt = 0;
    let turnsSurvived = 0;
    const battleLog: BattleLogEntry[] = [];
    const researchLevels = guild.research;
    
    let activeDebuffs: {
        [key in 'user_combat_power_reduction_percent' | 'user_heal_reduction_percent']: { value: number; turns: number }
    } = {
        user_combat_power_reduction_percent: { value: 0, turns: 0 },
        user_heal_reduction_percent: { value: 0, turns: 0 },
    };

    const runUserTurn = (isExtra: boolean = false): boolean => {
        let userDamage = (totalStats[CoreStat.CombatPower] * 3.2) + (totalStats[CoreStat.Judgment] * 2.6) + (totalStats[CoreStat.Calculation] * 1.8);
        // GuildBossDamage는 SpecialStat에 없으므로 임시로 처리
        const damageBonusPercent = (effects.specialStatBonuses as any)['GuildBossDamage']?.percent || 0;
        if (damageBonusPercent > 0) userDamage *= (1 + damageBonusPercent / 100);
        userDamage *= (1 + (Math.random() * 0.2 - 0.1));
        const critChance = 15 + (totalStats[CoreStat.Judgment] * 0.03);
        const isCrit = Math.random() * 100 < critChance;
        if (isCrit) {
            const critDamagePercent = ((totalStats[CoreStat.CombatPower] * 0.4) + (totalStats[CoreStat.Calculation] * 0.3)) + (Math.random() * 20 - 10);
            userDamage *= (1 + critDamagePercent / 100);
        }
    
        if(activeDebuffs.user_combat_power_reduction_percent.turns > 0) {
            userDamage *= (1 - activeDebuffs.user_combat_power_reduction_percent.value / 100);
        }
        
        userDamage = Math.round(userDamage);
        const commentary = isCrit ? criticalAttackCommentaries[Math.floor(Math.random() * criticalAttackCommentaries.length)] : normalAttackCommentaries[Math.floor(Math.random() * normalAttackCommentaries.length)];
        const extraTurnText = isExtra ? ' (추가 턴)' : '';
        battleLog.push({ turn: turnsSurvived, icon: GUILD_ATTACK_ICON, message: `[${user.nickname}] ${commentary}${extraTurnText} | 보스 HP -${userDamage.toLocaleString()}${isCrit ? ' (크리티컬!)' : ''}`, isUserAction: true, isCrit });
        totalDamageDealt += userDamage;

        if (boss.hp - totalDamageDealt <= 0) {
            battleLog.push({ turn: turnsSurvived, icon: GUILD_ATTACK_ICON, message: `[${user.nickname}]의 마지막 일격!`, isUserAction: true });
            battleLog.push({ turn: turnsSurvived, message: `[${boss.name}]이 돌을 거두었습니다.`, isUserAction: false });
            totalDamageDealt = boss.hp;
            return true; // Boss defeated
        }
        return false;
    };
    
    const runUserFullTurn = (): boolean => {
        let bossDefeated = runUserTurn(false);
        if (bossDefeated) return true;

        const extraTurnChance = totalStats[CoreStat.ThinkingSpeed] * 0.02;
        if (Math.random() * 100 < extraTurnChance) {
            battleLog.push({ turn: turnsSurvived, icon: '/images/guild/skill/userskill4.png', message: `[추가공격] 빠르고 정확한 사고속도로 추가 턴을 획득합니다.`, isUserAction: true, isCrit: false });
            bossDefeated = runUserTurn(true);
            if (bossDefeated) return true;
        }
        
        // Research: Ignite
        const igniteLevel = researchLevels?.[GuildResearchId.boss_skill_ignite]?.level || 0;
        if (igniteLevel > 0) {
            const igniteChances =   [0, 10, 25, 40, 55, 70, 85, 100];
            const damageIncreases = [0, 10, 15, 30, 45, 60, 75, 100];
            const chance = igniteChances[igniteLevel];
            if (Math.random() * 100 < chance) {
                let igniteDamage = boss.maxHp * 0.001; // Base fixed damage is 0.1% of max HP.
                const igniteDamageIncreasePercent = damageIncreases[igniteLevel];
                igniteDamage *= (1 + igniteDamageIncreasePercent / 100);
                igniteDamage = Math.round(igniteDamage);

                totalDamageDealt += igniteDamage;
                battleLog.push({ turn: turnsSurvived, icon: GUILD_RESEARCH_IGNITE_IMG, message: `[연구-점화] 발동! 보스 HP -${igniteDamage.toLocaleString()}`, isUserAction: true });
                if (boss.hp - totalDamageDealt <= 0) {
                    battleLog.push({ turn: turnsSurvived, message: `[연구-점화]의 피해로 [${boss.name}]이 돌을 거두었습니다.`, isUserAction: false });
                    totalDamageDealt = boss.hp;
                    return true;
                }
            }
        }

        // Research: Regen
        const regenLevel = researchLevels?.[GuildResearchId.boss_skill_regen]?.level || 0;
        if (regenLevel > 0) {
            const regenChances =    [0, 10, 25, 40, 55, 70, 85, 100];
            const healIncreases =   [0, 10, 20, 40, 60, 80, 100, 150];
            const chance = regenChances[regenLevel];
            if (Math.random() * 100 < chance) {
                let healAmount = (totalStats[CoreStat.Stability] * 0.5);
                const healAmountIncreasePercent = healIncreases[regenLevel];
                healAmount *= (1 + healAmountIncreasePercent / 100);
                healAmount = Math.round(healAmount);
                userHp = Math.min(maxUserHp, userHp + healAmount);
                battleLog.push({ turn: turnsSurvived, icon: GUILD_RESEARCH_REGEN_IMG, message: `[연구-지속회복] 발동! HP +${healAmount.toLocaleString()}`, isUserAction: true, healingDone: healAmount });
            }
        }
        
        return false;
    };

    const runBossFullTurn = (): boolean => {
        const performDuel = (stat: CoreStat): boolean => {
            const userStat = totalStats[stat];
            const bossStat = 1000; // Boss stats are effectively constant for duel calculation.
            // A more predictable success rate based on user vs. boss stat.
            const successRate = userStat / (userStat + bossStat);
            return Math.random() < successRate;
        };

        // Active Skill
        const activeSkills = boss.skills.filter((s): s is GuildBossActiveSkill => s.type === 'active');
        if (activeSkills.length > 0) {
            const bossSkill = activeSkills[Math.floor(Math.random() * activeSkills.length)];
            
            let successfulDuels = 0;
            const statsToCheck = Array.isArray(bossSkill.checkStat) ? bossSkill.checkStat : [bossSkill.checkStat];
            
            for (const stat of statsToCheck) {
                const randomStat = Array.isArray(stat) ? stat[Math.floor(Math.random() * stat.length)] : stat;
                if (performDuel(randomStat)) successfulDuels++;
            }
            
            let turnBossDamage = 0;
            let turnBossHeal = 0;
            let duelResultMessage = '';
            const debuffsForLog: BattleLogEntry['debuffsApplied'] = [];

            // Special handling for complex skills
            if (bossSkill.id === '녹수_포자확산') {
                let damageRange: [number, number];
                if (successfulDuels >= 2) damageRange = [2000, 3000];
                else if (successfulDuels === 1) damageRange = [3000, 4000];
                else damageRange = [5000, 8000];
                turnBossDamage = getRandom(damageRange[0], damageRange[1]);
                duelResultMessage = `방어 ${successfulDuels} / 3회 성공`;
            } else if (bossSkill.id === '백광_천벌의일격') {
                let damageRange: [number, number];
                if (successfulDuels === 2) damageRange = [2000, 3000];
                else if (successfulDuels === 1) damageRange = [4000, 5000];
                else damageRange = [6000, 10000];
                turnBossDamage = getRandom(damageRange[0], damageRange[1]);
                duelResultMessage = `방어 ${successfulDuels} / 2회 성공`;
            } else {
                const duelSuccess = successfulDuels === statsToCheck.length;
                const skillEffectsToApply = duelSuccess ? bossSkill.onSuccess : bossSkill.onFailure;
                duelResultMessage = duelSuccess ? '방어 성공' : '방어 실패';
                
                for (const effect of skillEffectsToApply) {
                    switch (effect.type) {
                        case 'damage':
                            turnBossDamage += getRandom(effect.value![0], effect.value![1]) * (effect.hits || 1);
                            break;
                        case 'hp_percent':
                            turnBossDamage += Math.round(maxUserHp * (getRandom(effect.value![0], effect.value![1]) / 100));
                            break;
                        case 'heal':
                            turnBossHeal += getRandom(effect.value![0], effect.value![1]);
                            break;
                        case 'debuff':
                            if (effect.debuffType && (effect.debuffType === 'user_combat_power_reduction_percent' || effect.debuffType === 'user_heal_reduction_percent')) {
                                const value = getRandom(effect.debuffValue![0], effect.debuffValue![1]);
                                activeDebuffs[effect.debuffType] = { value, turns: effect.debuffDuration ?? 0 };
                                debuffsForLog.push(effect.debuffType);
                            }
                            break;
                    }
                }
            }
            
            const finalDamageReduction = 200 / (200 + totalStats[CoreStat.Stability]);
            const finalBossDamage = Math.round(turnBossDamage * finalDamageReduction);
            userHp -= finalBossDamage;

            let logMessage = `[${boss.name}]의 ${bossSkill.name}! (${duelResultMessage})`;
            if(finalBossDamage > 0) logMessage += ` | 유저 HP -${finalBossDamage.toLocaleString()}`;
            if(turnBossHeal > 0) {
                totalDamageDealt -= turnBossHeal;
                logMessage += ` | 보스 HP +${turnBossHeal.toLocaleString()}`;
            }
            battleLog.push({ turn: turnsSurvived, icon: bossSkill.image, message: logMessage, isUserAction: false, damageTaken: finalBossDamage, bossHealingDone: turnBossHeal, debuffsApplied: debuffsForLog });
        }
        
        if (userHp <= 0) return true;
        
        // --- Passive Skills ---
        const passiveSkills = boss.skills.filter((s): s is GuildBossPassiveSkill => s.type === 'passive');
        for (const pSkill of passiveSkills) {
            const processPassiveEffect = (effect: GuildBossSkillSubEffect) => {
                switch(effect.type) {
                    case 'hp_percent':
                        const pDamage = Math.round(maxUserHp * (getRandom(effect.value![0], effect.value![1]) / 100));
                        userHp -= pDamage;
                        battleLog.push({ turn: turnsSurvived, icon: pSkill.image, message: `[${boss.name}]의 ${pSkill.name} 발동! | 유저 HP -${pDamage.toLocaleString()}`, isUserAction: false, damageTaken: pDamage });
                        break;
                    case 'debuff':
                         activeDebuffs[effect.debuffType!] = {
                             value: getRandom(effect.debuffValue![0], effect.debuffValue![1]),
                             turns: effect.debuffDuration!,
                         };
                         battleLog.push({ turn: turnsSurvived, icon: pSkill.image, message: `[${boss.name}]의 ${pSkill.name} 발동! 유저의 회복량이 감소합니다.`, isUserAction: false });
                        break;
                    case 'heal': {
                        let passiveHeal = getRandom(effect.value![0], effect.value![1]);
                        const healBlockLevel = researchLevels?.[GuildResearchId.boss_skill_heal_block]?.level || 0;
                        
                        if (healBlockLevel > 0 && passiveHeal > 0) {
                            const healBlockChances = [0, 10, 25, 40, 55, 70, 85, 100];
                            const healReductions =   [0, 0,  10, 20, 30, 40, 50, 0];
                            const chance = healBlockChances[healBlockLevel];
                            
                            if (Math.random() * 100 < chance) {
                                battleLog.push({ turn: turnsSurvived, icon: GUILD_RESEARCH_HEAL_BLOCK_IMG, message: `[연구-회복불가] 발동! 보스의 회복이 막혔습니다.`, isUserAction: true });
                                passiveHeal = 0;
                            } else {
                                const reduction = healReductions[healBlockLevel];
                                if (reduction > 0) {
                                    const reducedAmount = Math.round(passiveHeal * (reduction / 100));
                                    passiveHeal -= reducedAmount;
                                    battleLog.push({ turn: turnsSurvived, icon: GUILD_RESEARCH_HEAL_BLOCK_IMG, message: `[연구-회복감소] 발동! 보스의 회복량이 ${reducedAmount.toLocaleString()} 감소했습니다.`, isUserAction: true });
                                }
                            }
                        }
                        
                        if (passiveHeal > 0) {
                            totalDamageDealt -= passiveHeal;
                            battleLog.push({ turn: turnsSurvived, icon: pSkill.image, message: `[${boss.name}]의 ${pSkill.name} 발동! | 보스 HP +${passiveHeal.toLocaleString()}`, isUserAction: false, bossHealingDone: passiveHeal });
                        }
                        break;
                    }
                }
            };
            
            if (pSkill.passiveTrigger === 'always') {
                pSkill.passiveEffect.forEach(processPassiveEffect);
            } else if (pSkill.passiveTrigger === 'every_turn' && pSkill.checkStat) {
                if (!performDuel(pSkill.checkStat)) {
                    pSkill.passiveEffect.forEach(processPassiveEffect);
                }
            } else if (pSkill.passiveTrigger === 'on_user_heal' && pSkill.passiveChance) {
                 if (Math.random() < pSkill.passiveChance) {
                     pSkill.passiveEffect.forEach(processPassiveEffect);
                 }
            }
        }
        
        if (userHp <= 0) return true;

        // Decrement debuffs
        Object.keys(activeDebuffs).forEach(key => {
            if (activeDebuffs[key as keyof typeof activeDebuffs].turns > 0) {
                activeDebuffs[key as keyof typeof activeDebuffs].turns--;
            }
        });
        
        return false;
    };
    
    for (let turn = 1; turn <= BATTLE_TURNS; turn++) {
        turnsSurvived = turn;
        if (runUserFullTurn()) break;
        if (userHp <= 0) break;
        if (runBossFullTurn()) break;
        if (userHp <= 0) break;
    }
    
    const rewardCoins = 20 + Math.floor(Math.min(1, totalDamageDealt / 2000000) * 80);

    return {
        damageDealt: Math.max(0, Math.round(totalDamageDealt)),
        turnsSurvived,
        rewards: { guildCoins: rewardCoins },
        battleLog,
        bossHpBefore: boss.hp,
        bossHpAfter: Math.max(0, Math.round(boss.hp - Math.max(0, totalDamageDealt))),
        bossMaxHp: boss.maxHp,
        userHp: Math.max(0, userHp),
        maxUserHp,
    };
};
