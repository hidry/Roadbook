import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { appendLog } from '@/lib/debug-log';

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    void appendLog('RENDER:CRASH', error.message, { stack: info.componentStack.slice(0, 400) });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Unerwarteter Fehler</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
          <Text style={styles.hint}>Details wurden ins Diagnose-Log geschrieben.</Text>
        </View>
      );
    }
    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  title: { fontSize: 18, fontWeight: 'bold', marginBottom: 8 },
  message: { color: '#555', textAlign: 'center', marginBottom: 8 },
  hint: { color: '#888', fontSize: 12, textAlign: 'center' },
});
