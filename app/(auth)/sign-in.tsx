import { useSignIn } from "@clerk/expo";
import { useSignInWithGoogle } from "@clerk/expo/google";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    Text,
    TextInput,
    View,
} from "react-native";

// WebBrowser.maybeCompleteAuthSession();
export default function SignInScreen() {
    const { signIn, errors, fetchStatus } = useSignIn();
    // const { startSSOFlow } = useSSO();
    const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const loading = fetchStatus === "fetching";
    const handleGoogleSignIn = async () => {
        try {
            const {
                createdSessionId,
                setActive,
            } = await startGoogleAuthenticationFlow();

            if (createdSessionId && setActive) {
                await setActive({
                    session: createdSessionId,
                });

                router.replace("/");
            }
        } catch (error: any) {
    if (
        error?.code === "SIGN_IN_CANCELLED" ||
        error?.code === "-5"
    ) {
        return;
    }

    console.log(
        "GOOGLE SIGN-IN ERROR:",
        JSON.stringify(error, null, 2)
    );

    Alert.alert(
        "Google sign-in failed",
        error?.message ||
        "Could not sign in with Google."
    );
}
    };

    const handleSignIn = async () => {
        if (!email || !password) {
            Alert.alert(
                "Missing information",
                "Please enter your email and password."
            );
            return;
        }

        const { error } = await signIn.password({
            emailAddress: email.trim(),
            password,
        });

        if (error) {
            console.log(
                "SIGN IN ERROR:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Sign in failed",
                errors.fields?.identifier?.message ||
                errors.fields?.password?.message ||
                "Unable to sign in. Please check your credentials."
            );

            return;
        }

        if (signIn.status === "complete") {
            await signIn.finalize({
                navigate: () => {
                    router.replace("/");
                },
            });

            return;
        }

        if (signIn.status === "needs_second_factor") {
            Alert.alert(
                "Additional verification required",
                "Your account requires another verification step."
            );

            return;
        }

        if (signIn.status === "needs_client_trust") {
            Alert.alert(
                "Verify this device",
                "Additional verification is required for this device."
            );

            return;
        }

        console.log(
            "Sign-in not complete:",
            signIn.status
        );
    };

    return (
        <KeyboardAvoidingView
            className="flex-1 bg-slate-950"
            behavior={
                Platform.OS === "ios"
                    ? "padding"
                    : undefined
            }
        >
            <ScrollView
                contentContainerClassName="flex-grow justify-center px-6 py-12"
                keyboardShouldPersistTaps="handled"
            >
                <View className="w-full">

                    {/* BRAND */}
                    <View className="mb-10 items-center">
                        <View className="mb-5 h-20 w-20 items-center justify-center rounded-3xl bg-white">
                            <Text className="text-3xl font-black text-slate-950">
                                AI
                            </Text>
                        </View>

                        <Text className="text-3xl font-bold text-white">
                            Welcome back
                        </Text>

                        <Text className="mt-2 text-center text-base text-slate-400">
                            Sign in to your personal AI Assistant
                        </Text>
                    </View>

                    {/* EMAIL */}
                    <View className="mb-4">
                        <Text className="mb-2 ml-1 text-sm font-medium text-slate-300">
                            Email
                        </Text>

                        <TextInput
                            value={email}
                            onChangeText={setEmail}
                            placeholder="you@example.com"
                            placeholderTextColor="#64748b"
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="email-address"
                            className="h-14 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-base text-white"
                        />

                        {errors.fields?.identifier && (
                            <Text className="mt-2 ml-1 text-sm text-red-400">
                                {errors.fields.identifier.message}
                            </Text>
                        )}
                    </View>

                    {/* PASSWORD */}
                    <View className="mb-3">
                        <Text className="mb-2 ml-1 text-sm font-medium text-slate-300">
                            Password
                        </Text>

                        <TextInput
                            value={password}
                            onChangeText={setPassword}
                            placeholder="Your password"
                            placeholderTextColor="#64748b"
                            secureTextEntry
                            className="h-14 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-base text-white"
                        />

                        {errors.fields?.password && (
                            <Text className="mt-2 ml-1 text-sm text-red-400">
                                {errors.fields.password.message}
                            </Text>
                        )}
                    </View>

                    {/* FORGOT PASSWORD */}
                    <View className="mb-6 items-end">
                        <Link href="/forgot-password" asChild>
                            <Pressable>
                                <Text className="text-sm font-medium text-slate-400">
                                    Forgot password?
                                </Text>
                            </Pressable>
                        </Link>
                    </View>

                    {/* SIGN IN */}
                    <Pressable
                        onPress={handleSignIn}
                        disabled={loading}
                        className={`h-14 items-center justify-center rounded-2xl bg-white ${loading ? "opacity-50" : ""
                            }`}
                    >
                        <Text className="text-base font-bold text-slate-950">
                            {loading ? "Signing in..." : "Sign in"}
                        </Text>
                    </Pressable>

                    {/* DIVIDER */}
                    <View className="my-7 flex-row items-center">
                        <View className="h-px flex-1 bg-slate-800" />

                        <Text className="mx-4 text-xs text-slate-500">
                            OR
                        </Text>

                        <View className="h-px flex-1 bg-slate-800" />
                    </View>

                    {/* GOOGLE */}
                    <Pressable
                        className="h-14 flex-row items-center justify-center rounded-2xl border border-slate-800 bg-slate-900"
                        onPress={handleGoogleSignIn}
                    >
                        <Text className="mr-3 text-lg font-bold text-white">
                            G
                        </Text>

                        <Text className="text-base font-semibold text-white">
                            Continue with Google
                        </Text>
                    </Pressable>

                    {/* SIGN UP */}
                    <View className="mt-8 flex-row justify-center">
                        <Text className="text-sm text-slate-500">
                            Don't have an account?{" "}
                        </Text>

                        <Link href="/sign-up" asChild>
                            <Pressable>
                                <Text className="text-sm font-bold text-white">
                                    Sign up
                                </Text>
                            </Pressable>
                        </Link>
                    </View>

                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}