import { TextInput } from 'react-native-gesture-handler';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import * as User from '@/components/ui/user';
import { useUserProfile } from '@nostr-dev-kit/ndk-mobile';
import { Text } from '@/components/nativewindui/Text';
import { Button } from '@/components/nativewindui/Button';
import { activeEventStore } from './stores';
import { useStore } from 'zustand';
import { useNDKCurrentUser } from '@nostr-dev-kit/ndk-mobile';

export default function CommentScreen() {
    const currentUser = useNDKCurrentUser();
    const [comment, setComment] = useState('');
    const { userProfile } = useUserProfile(currentUser?.pubkey);
    const activeEvent = useStore(activeEventStore, (state) => state.activeEvent);

    const postComment = async () => {
        const event = activeEvent.reply()
        event.content = comment;
        await event.sign();
        event.publish();

        // close modal
        router.back();
    };

    return (
        <>
            <View className="flex-1 items-start bg-card p-4">
                <KeyboardAwareScrollView>
                    <View className="w-full flex-row items-start justify-between">
                        <View className="mb-4 flex-row items-center gap-2">
                            <User.Avatar userProfile={userProfile} size={48} alt="Profile image" />
                            <Text className="text-lg font-bold">
                                <User.Name userProfile={userProfile} pubkey={currentUser?.pubkey} />
                            </Text>
                        </View>

                        <Button variant="plain" onPress={postComment}>
                            <Text>Post</Text>
                        </Button>
                    </View>

                    <View className="grow">
                        <TextInput
                            className="text-foreground"
                            placeholder="Add a comment..."
                            multiline
                            autoFocus
                            value={comment}
                            onChangeText={setComment}
                        />
                    </View>
                </KeyboardAwareScrollView>
            </View>
        </>
    );
}
