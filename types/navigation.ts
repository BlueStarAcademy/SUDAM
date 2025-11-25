
import { GameMode } from './enums.js';

export type AppRoute = {
    view: 'login' | 'register' | 'kakao-callback' | 'set-nickname' | 'profile' | 'lobby' | 'waiting' | 'game' | 'admin' | 'tournament' | 'singleplayer' | 'guild' | 'guildboss' | 'guildwar' | 'tower';
    params: any;
};

export function parseHash(hash: string): AppRoute {
    const path = hash.replace(/^#\/?/, '');
    const [view, ...rest] = path.split('/');

    switch (view) {
        case 'lobby': return { view: 'lobby', params: { type: rest[0] || 'strategic' } };
        case 'waiting': return { view: 'waiting', params: { mode: rest[0] ? decodeURIComponent(rest[0]) as GameMode : null } };
        case 'game': return { view: 'game', params: { id: rest[0] } };
        case 'tournament': return { view: 'tournament', params: { type: rest[0] || null } };
        case 'singleplayer': return { view: 'singleplayer', params: {} };
        case 'guild': return { view: 'guild', params: {} };
        case 'guildboss': return { view: 'guildboss', params: {} };
        case 'guildwar': return { view: 'guildwar', params: {} };
        case 'tower': return { view: 'tower', params: {} };
        case 'admin': return { view: 'admin', params: {} };
        case 'register': return { view: 'register', params: {} };
        case 'set-nickname': return { view: 'set-nickname', params: {} };
        case 'profile': return { view: 'profile', params: {} };
        case 'auth': 
            if (rest[0] === 'kakao' && rest[1] === 'callback') {
                return { view: 'kakao-callback', params: {} };
            }
            return { view: 'login', params: {} };
        default: return { view: 'login', params: {} };
    }
}