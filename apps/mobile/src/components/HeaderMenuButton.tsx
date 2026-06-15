import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from 'expo-router';
import { Pressable } from 'react-native';

import { colors } from '@/theme';

/** White hamburger for the primary app-bar; opens the parent drawer. */
export function HeaderMenuButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      // Raw OPEN_DRAWER action (== DrawerActions.openDrawer()) bubbles to the
      // drawer ancestor — avoids importing @react-navigation/native directly.
      onPress={() => navigation.dispatch({ type: 'OPEN_DRAWER' })}
      hitSlop={12}
      style={{ paddingRight: 6 }}
    >
      <Ionicons name="menu" size={24} color={colors.onPrimary} />
    </Pressable>
  );
}
