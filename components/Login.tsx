
import React, { useState } from 'react';
import Button from './Button.js';
import { useAppContext } from '../hooks/useAppContext.js';

const Login: React.FC = () => {
  const { setCurrentUserAndRoute } = useAppContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('아이디와 비밀번호를 모두 입력해주세요.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      
      if (!response.ok) {
        let errorMessage = `로그인 실패 (${response.statusText})`;
        try {
            const errorData = await response.json();
            if (errorData && errorData.message) {
                errorMessage = errorData.message;
            }
        } catch (e) {
            console.error("Login failed with a non-JSON response body.", e);
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setCurrentUserAndRoute(data.user);
      
      // 닉네임이 없거나 임시 닉네임이면 닉네임 설정 화면으로, 아니면 프로필로
      if (!data.user.nickname || data.user.nickname.startsWith('user_')) {
        window.location.hash = '#/set-nickname';
      } else {
        window.location.hash = '#/profile';
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center">
      <div className="w-full max-w-sm p-6 space-y-6 bg-gray-800 rounded-lg shadow-2xl border border-color">
        <div>
          <p className="mt-2 text-center text-gray-400">아이디와 비밀번호를 입력하여 로그인하세요.</p>
        </div>
        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="rounded-md shadow-sm space-y-4">
            <div>
              <label htmlFor="username-login" className="sr-only">Username</label>
              <input
                id="username-login"
                name="username"
                type="text"
                autoComplete="username"
                required
                className="appearance-none rounded-md relative block w-full px-4 py-3 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="아이디"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
             <div>
              <label htmlFor="password-login" className="sr-only">Password</label>
              <input
                id="password-login"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className="appearance-none rounded-md relative block w-full px-4 py-3 border border-gray-700 bg-gray-900 text-white placeholder-gray-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 focus:z-10 sm:text-sm"
                placeholder="비밀번호"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          
          {error && <p className="text-sm text-red-400 text-center">{error}</p>}

          <div className="w-full flex justify-center">
             <Button 
                type="submit"
                disabled={isLoading}
                className="w-full py-3 text-lg"
             >
                {isLoading ? '로그인 중...' : '로그인'}
             </Button>
          </div>
        </form>
         <div className="text-sm text-center">
            <a href="#/register" onClick={(e) => { e.preventDefault(); window.location.hash = '#/register'; }} className="font-medium text-blue-400 hover:text-blue-300">
              계정이 없으신가요? 회원가입
            </a>
          </div>

        <div className="relative">
            <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-600" />
            </div>
            <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-gray-800 text-gray-400">또는 소셜 계정으로 로그인</span>
            </div>
        </div>

        <div className="flex justify-center gap-3">
             <Button 
                colorScheme="yellow" 
                className="w-full"
                onClick={async () => {
                    try {
                        const response = await fetch('/api/auth/kakao/url');
                        const data = await response.json();
                        if (data.url) {
                            window.location.href = data.url;
                        }
                    } catch (err: any) {
                        setError('카카오 로그인에 실패했습니다.');
                    }
                }}
             >
                카카오 로그인
             </Button>
        </div>
      </div>
    </div>
  );
};

export default Login;
