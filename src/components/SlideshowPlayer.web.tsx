/**
 * Web stub for the slideshow player — MapLibre (native module) has no web
 * support, and the slideshow is a device feature. Mirrors the MapView pattern.
 */
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui';
import type { Slide } from '@/lib/slideshow';

export function SlideshowPlayer({ slides, onClose }: { slides: Slide[]; onClose: () => void }) {
  return (
    <View style={styles.placeholder} testID="slideshow-web">
      <ThemedText type="small">Die Diashow ist auf dem Gerät (iOS/Android) verfügbar.</ThemedText>
      <ThemedText type="small">{slides.length} Folie(n) berechnet</ThemedText>
      <Button title="Zurück" variant="secondary" onPress={onClose} />
    </View>
  );
}

const styles = StyleSheet.create({
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
