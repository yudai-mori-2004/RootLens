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
            }}
        >
            {children}
        </PrivyProvider>
    );
}