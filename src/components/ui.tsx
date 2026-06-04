/**
 * Minimal shared UI primitives (Button, TextField, Screen, Card, Field) so the
 * screens stay focused on behaviour rather than styling. Theme-aware via
 * useTheme(); intentionally small — this is an MVP, not a design system.
 */
import { forwardRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
  type ViewProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const PRIMARY = '#208AEF';
const DANGER = '#E5484D';

export function Screen({ children, scroll = true }: { children: React.ReactNode; scroll?: boolean }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const Body = scroll ? ScrollView : View;
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top', 'left', 'right']}>
      <Body
        style={styles.flex}
        contentContainerStyle={scroll ? [styles.scrollContent, { paddingBottom: Spacing.three + insets.bottom }] : undefined}
        keyboardShouldPersistTaps={scroll ? 'handled' : undefined}>
        {children}
      </Body>
    </SafeAreaView>
  );
}

export function Card({ style, children, ...rest }: ViewProps) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.backgroundElement }, style]} {...rest}>
      {children}
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
};

export function Button({ title, onPress, loading, disabled, variant = 'primary' }: ButtonProps) {
  const theme = useTheme();
  const bg = variant === 'primary' ? PRIMARY : variant === 'danger' ? DANGER : theme.backgroundSelected;
  const fg = variant === 'secondary' ? theme.text : '#ffffff';
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 }]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <ThemedText style={[styles.buttonText, { color: fg }]}>{title}</ThemedText>
      )}
    </Pressable>
  );
}

export const TextField = forwardRef<TextInput, TextInputProps & { label?: string }>(function TextField(
  { label, style, ...rest },
  ref,
) {
  const theme = useTheme();
  return (
    <View style={styles.fieldWrap}>
      {label ? (
        <ThemedText type="smallBold" style={styles.label}>
          {label}
        </ThemedText>
      ) : null}
      <TextInput
        ref={ref}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { color: theme.text, backgroundColor: theme.backgroundElement, borderColor: theme.backgroundSelected },
          style,
        ]}
        {...rest}
      />
    </View>
  );
});

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <ThemedText type="small" style={{ color: DANGER }}>
      {children}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scrollContent: { padding: Spacing.three, gap: Spacing.three },
  card: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.two },
  button: {
    minHeight: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  buttonText: { fontWeight: '700' },
  fieldWrap: { gap: Spacing.one },
  label: {},
  input: {
    minHeight: 48,
    borderRadius: Spacing.two,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
});
