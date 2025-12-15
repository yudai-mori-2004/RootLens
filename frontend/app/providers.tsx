'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

export default function Providers({ children }: { children: React.ReactNode }) {
    const solanaConnectors = toSolanaWalletConnectors({
        shouldAutoConnect: false, // ページロード時の自動接続を無効化
    });

    return (
        <PrivyProvider
            appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID || ''}
            config={{
                appearance: {
                    theme: 'light',
                    accentColor: '#676FFF',
                    showWalletLoginFirst: true,
                    walletChainType: 'solana-only',
                },
                externalWallets: {
                    solana: {
                        connectors: solanaConnectors,
                    },
                },
                solana: {
                    // Solana RPC設定（トランザクション送信に必要）
                    rpcs: {
                        // Devnet用RPC
                        'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1':
                            process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.devnet.solana.com',
                        // Mainnet用RPC（本番環境用）
                        'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp':
                            'https://api.mainnet-beta.solana.com',
                    } as any,
                },
            }}
        >
            {children}
        </PrivyProvider>
    );
}