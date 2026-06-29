import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
          {/* Clear the boundary so the user isn't dead-ended (e.g. can reach the
              menu / diagnostic log). If the same screen re-crashes immediately,
              tapping again is harmless. */}
          <Pressable style={styles.button} onPress={() => this.setState({ error: null })}>
            <Text style={styles.buttonText}>Erneut versuchen</Text>
          </Pressable>
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
  button: {
    marginTop: 20,
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 24,
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
