import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function SignUpScreen() {
  const { signUp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setNotice(null);
    if (password.length < 6) {
      setError('Passwort muss mindestens 6 Zeichen haben.');
      return;
    }
    setLoading(true);
    const { error } = await signUp(email, password);
    setLoading(false);
    if (error) {
      setError(error);
      return;
    }
    // With email confirmation enabled there is no session yet; tell the user.
    setNotice('Konto erstellt. Falls E-Mail-Bestätigung aktiv ist, bestätige bitte den Link, dann melde dich an.');
    router.replace('/');
  }

  return (
    <Screen>
      <View style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          Registrieren
        </ThemedText>
        <ThemedText type="small" style={styles.subtitle}>
          Erstelle ein Konto mit E-Mail und Passwort.
        </ThemedText>

        <TextField
          label="E-Mail"
          testID="signup-email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="du@example.com"
        />
        <TextField
          label="Passwort"
          testID="signup-password"
          secureTextEntry
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
          placeholder="mind. 6 Zeichen"
        />
        <ErrorText>{error}</ErrorText>
        {notice ? <ThemedText type="small">{notice}</ThemedText> : null}
        <Button title="Konto erstellen" onPress={onSubmit} loading={loading} disabled={!email || !password} />

        <View style={styles.footer}>
          <ThemedText type="small">Schon ein Konto? </ThemedText>
          <Link href="/login">
            <ThemedText type="linkPrimary">Anmelden</ThemedText>
          </Link>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.three, paddingTop: Spacing.six },
  title: { textAlign: 'center', fontSize: 40, lineHeight: 44 },
  subtitle: { textAlign: 'center', marginBottom: Spacing.two },
  footer: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: Spacing.two },
});
