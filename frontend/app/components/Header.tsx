'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePrivy } from '@privy-io/react-auth';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Wallet, LogOut, User, Search, Upload } from 'lucide-react';

interface HeaderProps {
  isLandingPage?: boolean;
}

export default function Header({ isLandingPage = false }: HeaderProps) {
  const { login, authenticated, logout, user } = usePrivy();

  const truncateAddress = (address: string) => {
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  return (
    <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
        {/* Logo & Brand */}
        <Link href="/" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
          <Image
            src="/icon_white.png"
            alt="RootLens Logo"
            width={32}
            height={32}
            className="rounded-lg shadow-sm"
          />
          <span className="text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-700 to-indigo-700 hidden sm:inline-block">
            RootLens
          </span>
        </Link>

        {/* Navigation & Wallet */}
        <div className="flex items-center gap-4">
          {/* Desktop Nav */}
          <nav className="hidden md:flex gap-6 text-sm font-medium text-slate-600 items-center mr-2">
            {isLandingPage ? (
              <>
                <Link href="#why" className="hover:text-blue-600 transition-colors">背景</Link>
                <Link href="#technology" className="hover:text-blue-600 transition-colors">技術</Link>
                <Link href="#values" className="hover:text-blue-600 transition-colors">特徴</Link>
                <Link href="#faq" className="hover:text-blue-600 transition-colors">FAQ</Link>
                <div className="h-4 w-px bg-slate-200 mx-2" />
                <Link href="/lens" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  <Search className="w-4 h-4" />
                  Lens
                </Link>
              </>
            ) : (
              <>
                <Link href="/lens" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  <Search className="w-4 h-4" />
                  Lens
                </Link>
                <Link href="/upload" className="hover:text-blue-600 transition-colors flex items-center gap-1">
                  <Upload className="w-4 h-4" />
                  Upload
                </Link>
              </>
            )}
          </nav>

          {/* Wallet Button */}
          {authenticated && user?.wallet ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="rounded-full pl-2 pr-3 gap-2 border-indigo-200 bg-indigo-50/50 hover:bg-indigo-100 transition-colors">
                  <div className="w-6 h-6 bg-indigo-100 rounded-full flex items-center justify-center">
                    <User className="w-3.5 h-3.5 text-indigo-600" />
                  </div>
                  <span className="font-mono text-xs text-indigo-900">
                    {truncateAddress(user.wallet.address)}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="cursor-pointer">
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} className="text-red-600 cursor-pointer focus:text-red-700 focus:bg-red-50">
                  <LogOut className="w-4 h-4 mr-2" />
                  Disconnect Wallet
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button 
              onClick={login} 
              size="sm" 
              className="rounded-full bg-slate-900 hover:bg-slate-800 text-white gap-2"
            >
              <Wallet className="w-4 h-4" />
              <span className="hidden sm:inline">Connect Wallet</span>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
