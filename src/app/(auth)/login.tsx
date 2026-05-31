import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, ErrorText, Screen, TextField } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth/AuthProvider';

export default function LoginScreen() {
  const { signIn } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    const { error } = await signIn(email, password);
    setLoading(false);
    if (error) setError(error);
    else router.replace('/');
  }

  return (
    <Screen>
      <View style={styles.container}>
        <ThemedText type="title" style={styles.title}>
          Roadbook
        </ThemedText>
        <ThemedText type="small" style={styles.subtitle}>
          Melde dich an, um deine Reisen zu verwalten.
        </ThemedText>

        <TextField
          label="E-Mail"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="du@example.com"
        />
        <TextField
          label="Passwort"
          secureTextEntry
          autoComplete="current-password"
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
        />
        <ErrorText>{error}</ErrorText>
        <Button title="Anmelden" onPress={onSubmit} loading={loading} disabled={!email || !password} />

        <View style={styles.footer}>
          <ThemedText type="small">Noch kein Konto? </ThemedText>
          <Link href="/sign-up">
            <ThemedText type="linkPrimary">Registrieren</ThemedText>
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
