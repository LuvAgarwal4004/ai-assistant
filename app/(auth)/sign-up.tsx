import { useSignUp } from "@clerk/expo";
import { useSignInWithGoogle } from "@clerk/expo/google";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import {
    Alert,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from "react-native";

// WebBrowser.maybeCompleteAuthSession();
export default function SignUpScreen() {
    const { signUp, errors, fetchStatus } = useSignUp();
    // const { startSSOFlow } = useSSO();
    const { startGoogleAuthenticationFlow } = useSignInWithGoogle();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [code, setCode] = useState("");

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const [verificationStarted, setVerificationStarted] = useState(false);

    const loading = fetchStatus === "fetching";

    const handleGoogleSignUp = async () => {
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
        "GOOGLE SIGN-UP ERROR:",
        JSON.stringify(error, null, 2)
    );

    Alert.alert(
        "Google sign-up failed",
        error?.message ||
        "Could not sign up with Google."
    );
}
    };

    const handleSignUp = async () => {
        if (!email || !password || !confirmPassword) {
            Alert.alert(
                "Missing information",
                "Please fill in all the fields."
            );
            return;
        }

        if (password !== confirmPassword) {
            Alert.alert(
                "Passwords don't match",
                "Please make sure both passwords are the same."
            );
            return;
        }

        const { error } = await signUp.password({
            emailAddress: email.trim(),
            password,
        });

        if (error) {
            console.log(
                "SIGN UP ERROR:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Sign up failed",
                error.message ||
                "Unable to create your account."
            );

            return;
        }

        const { error: verificationError } =
            await signUp.verifications.sendEmailCode();

        if (verificationError) {
            console.log(
                "VERIFICATION ERROR:",
                JSON.stringify(
                    verificationError,
                    null,
                    2
                )
            );

            Alert.alert(
                "Verification error",
                verificationError.message ||
                "Could not send verification code."
            );

            return;
        }

        setVerificationStarted(true);
    };

    const handleVerify = async () => {
        if (!code) {
            Alert.alert(
                "Missing code",
                "Enter the verification code sent to your email."
            );
            return;
        }

        const { error } =
            await signUp.verifications.verifyEmailCode({
                code,
            });

        if (error) {
            console.log(
                "VERIFY ERROR:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Verification failed",
                error.message ||
                "Invalid or expired verification code."
            );

            return;
        }

        if (signUp.status === "complete") {
            await signUp.finalize({
                navigate: () => {
                    router.replace("/");
                },
            });
        }
    };
    const styles = StyleSheet.create({
        input: {
            height: 56,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#1e293b",
            backgroundColor: "#0f172a",
            paddingHorizontal: 16,
            fontSize: 16,
            color: "#ffffff",
        },

        passwordInput: {
            height: 56,
            flex: 1,
            paddingHorizontal: 16,
            fontSize: 16,
            color: "#ffffff",
        },

        codeInput: {
            height: 56,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#1e293b",
            backgroundColor: "#0f172a",
            paddingHorizontal: 16,
            textAlign: "center",
            fontSize: 18,
            letterSpacing: 4,
            color: "#ffffff",
        },
    });

    if (verificationStarted) {
        return (
            <KeyboardAvoidingView
                className="flex-1 bg-slate-950"
                behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
                <ScrollView
                    contentContainerClassName="flex-grow justify-center px-6 py-12"
                    keyboardShouldPersistTaps="handled"
                >
                    <View className="w-full">
                        <View className="mb-10 items-center">
                            <View className="mb-5 h-20 w-20 items-center justify-center rounded-3xl bg-white">
                                <Text className="text-3xl font-black text-slate-950">
                                    AI
                                </Text>
                            </View>

                            <Text className="text-3xl font-bold text-white">
                                Verify your email
                            </Text>

                            <Text className="mt-2 text-center text-base text-slate-400">
                                We sent a verification code to
                            </Text>

                            <Text className="mt-1 text-center font-semibold text-white">
                                {email}
                            </Text>
                        </View>

                        <TextInput
                            value={code}
                            onChangeText={setCode}
                            placeholder="Enter verification code"
                            placeholderTextColor="#64748b"
                            keyboardType="number-pad"
                            style={styles.codeInput}
                        />

                        {errors.fields?.code && (
                            <Text className="mb-4 text-center text-sm text-red-400">
                                {errors.fields.code.message}
                            </Text>
                        )}

                        <Pressable
                            onPress={handleVerify}
                            disabled={loading}
                            className={`h-14 items-center justify-center rounded-2xl bg-white ${loading ? "opacity-50" : ""
                                }`}
                        >
                            <Text className="text-base font-bold text-slate-950">
                                {loading ? "Verifying..." : "Verify email"}
                            </Text>
                        </Pressable>

                        <Pressable
                            className="mt-5 items-center"
                            onPress={async () => {
                                const { error } =
                                    await signUp.verifications.sendEmailCode();

                                if (error) {
                                    Alert.alert(
                                        "Error",
                                        error.message ||
                                        "Could not resend code."
                                    );
                                } else {
                                    Alert.alert(
                                        "Code sent",
                                        "A new verification code has been sent."
                                    );
                                }
                            }}
                        >
                            <Text className="text-sm font-medium text-slate-400">
                                Resend verification code
                            </Text>
                        </Pressable>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>
        );
    }

    return (
        <KeyboardAvoidingView
            className="flex-1 bg-slate-950"
            behavior={Platform.OS === "ios" ? "padding" : undefined}
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
                            Create account
                        </Text>

                        <Text className="mt-2 text-center text-base text-slate-400">
                            Create your personal AI Assistant account
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
                            style={styles.input}
                        />

                        {errors.fields?.emailAddress && (
                            <Text className="mt-2 ml-1 text-sm text-red-400">
                                {errors.fields.emailAddress.message}
                            </Text>
                        )}
                    </View>

                    {/* PASSWORD */}
                    <View className="mb-4">
                        <Text className="mb-2 ml-1 text-sm font-medium text-slate-300">
                            Password
                        </Text>

                        <View className="flex-row items-center rounded-2xl border border-slate-800 bg-slate-900">
                            <TextInput
                                value={password}
                                onChangeText={setPassword}
                                placeholder="Create a password"
                                placeholderTextColor="#64748b"
                                secureTextEntry={!showPassword}
                                style={styles.passwordInput}
                            />

                            <Pressable
                                onPress={() =>
                                    setShowPassword(!showPassword)
                                }
                                className="px-4"
                            >
                                <Text className="text-sm font-medium text-slate-400">
                                    {showPassword ? "Hide" : "Show"}
                                </Text>
                            </Pressable>
                        </View>

                        {errors.fields?.password && (
                            <Text className="mt-2 ml-1 text-sm text-red-400">
                                {errors.fields.password.message}
                            </Text>
                        )}
                    </View>

                    {/* CONFIRM PASSWORD */}
                    <View className="mb-6">
                        <Text className="mb-2 ml-1 text-sm font-medium text-slate-300">
                            Confirm password
                        </Text>

                        <View className="flex-row items-center rounded-2xl border border-slate-800 bg-slate-900">
                            <TextInput
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                placeholder="Confirm your password"
                                placeholderTextColor="#64748b"
                                secureTextEntry={!showConfirmPassword}
                                style={styles.passwordInput}
                            />

                            <Pressable
                                onPress={() =>
                                    setShowConfirmPassword(
                                        !showConfirmPassword
                                    )
                                }
                                className="px-4"
                            >
                                <Text className="text-sm font-medium text-slate-400">
                                    {showConfirmPassword ? "Hide" : "Show"}
                                </Text>
                            </Pressable>
                        </View>

                        {confirmPassword.length > 0 &&
                            password !== confirmPassword && (
                                <Text className="mt-2 ml-1 text-sm text-red-400">
                                    Passwords don't match.
                                </Text>
                            )}
                    </View>

                    {/* CREATE ACCOUNT */}
                    <Pressable
                        onPress={handleSignUp}
                        disabled={loading}
                        className={`h-14 items-center justify-center rounded-2xl bg-white ${loading ? "opacity-50" : ""
                            }`}
                    >
                        <Text className="text-base font-bold text-slate-950">
                            {loading
                                ? "Creating account..."
                                : "Create account"}
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
                        onPress={handleGoogleSignUp}
                    >
                        <Text className="mr-3 text-lg font-bold text-white">
                            G
                        </Text>

                        <Text className="text-base font-semibold text-white">
                            Continue with Google
                        </Text>
                    </Pressable>

                    {/* SIGN IN */}
                    <View className="mt-8 flex-row justify-center">
                        <Text className="text-sm text-slate-500">
                            Already have an account?{" "}
                        </Text>

                        <Link href="/sign-in" asChild>
                            <Pressable>
                                <Text className="text-sm font-bold text-white">
                                    Sign in
                                </Text>
                            </Pressable>
                        </Link>
                    </View>
                </View>
            </ScrollView>
        </KeyboardAvoidingView>
    );
}