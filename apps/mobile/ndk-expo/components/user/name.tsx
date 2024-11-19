import React from 'react';
import { Text } from 'react-native';
import { useUserProfile } from './profile';
import { useColorScheme } from '@/lib/useColorScheme';

/**
 * Renders the name of a user
 */
const Name: React.FC<Text['props']> = (props) => {
    // const { userProfile, user, hasKind20 } = useUserProfile();
    const { userProfile, user, } = useUserProfile();
    const { colors } = useColorScheme();

    return (
        <Text
            style={[
            //     { color: hasKind20 ? colors.accent : colors.foreground },
            //     { fontWeight: hasKind20 ? 'bold' : 'normal' },
                props.style,
            ]}
            {...props}>
            {userProfile?.displayName ||
                userProfile?.name ||
                user?.npub.substring(0, 6)}
        </Text>
    );
};

export default Name;
