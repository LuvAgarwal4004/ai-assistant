import { useSignIn } from "@clerk/expo";
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

export default function ForgotPasswordScreen() {
    const { signIn, errors, fetchStatus } = useSignIn();
    const router = useRouter();

    const [email, setEmail] = useState("");
    const [code, setCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");

    const [step, setStep] = useState("email");
    const [submitting, setSubmitting] = useState(false);

    const loading = fetchStatus === "fetching";

    // --------------------------------------------------
    // STEP 1
    // SEND OTP
    // --------------------------------------------------

    const sendCode = async () => {
        const cleanEmail = email.trim();

        if (!cleanEmail) {
            Alert.alert(
                "Missing email",
                "Please enter your email address."
            );
            return;
        }

        try {
            setSubmitting(true);

            // Start the password-reset sign-in attempt
            const { error: createError } =
                await signIn.create({
                    identifier: cleanEmail,
                });

            if (createError) {
                console.log(
                    "CREATE RESET ERROR:",
                    JSON.stringify(createError, null, 2)
                );

                Alert.alert(
                    "Unable to continue",
                    createError.message ||
                    "We couldn't find an account with that email."
                );

                return;
            }

            // Ask Clerk to send the OTP
            const { error: sendError } =
                await signIn.resetPasswordEmailCode.sendCode();

            if (sendError) {
                console.log(
                    "SEND RESET CODE ERROR:",
                    JSON.stringify(sendError, null, 2)
                );

                Alert.alert(
                    "Could not send code",
                    sendError.message ||
                    "We couldn't send the password reset code."
                );

                return;
            }

            setStep("code");

            Alert.alert(
                "Code sent",
                `We've sent a password reset code to ${cleanEmail}.`
            );
        } catch (error) {
            console.log(
                "SEND CODE EXCEPTION:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Something went wrong",
                "Unable to send the reset code."
            );
        } finally {
            setSubmitting(false);
        }
    };

    // --------------------------------------------------
    // STEP 2
    // VERIFY OTP
    // --------------------------------------------------

    const verifyCode = async () => {
        const cleanCode = code.trim();

        if (!cleanCode) {
            Alert.alert(
                "Missing code",
                "Please enter the verification code."
            );
            return;
        }

        try {
            setSubmitting(true);

            const { error } =
                await signIn.resetPasswordEmailCode.verifyCode({
                    code: cleanCode,
                });

            if (error) {
                console.log(
                    "VERIFY CODE ERROR:",
                    JSON.stringify(error, null, 2)
                );

                Alert.alert(
                    "Invalid code",
                    error.message ||
                    "The code is invalid or has expired."
                );

                return;
            }

            console.log(
                "OTP VERIFIED",
                signIn.status
            );

            // Clerk should now be in:
            // needs_new_password

            setStep("password");
        } catch (error) {
            console.log(
                "VERIFY CODE EXCEPTION:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Verification failed",
                "Something went wrong while verifying the code."
            );
        } finally {
            setSubmitting(false);
        }
    };

    // --------------------------------------------------
    // STEP 3
    // RESET PASSWORD
    // --------------------------------------------------

    const resetPassword = async () => {
        if (!password || !confirmPassword) {
            Alert.alert(
                "Missing information",
                "Please enter and confirm your new password."
            );
            return;
        }

        if (password.length < 8) {
            Alert.alert(
                "Password too short",
                "Your password must be at least 8 characters long."
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

        try {
            setSubmitting(true);

            const { error } =
                await signIn.resetPasswordEmailCode.submitPassword({
                    password,
                    signOutOfOtherSessions: true,
                });

            if (error) {
                console.log(
                    "RESET PASSWORD ERROR:",
                    JSON.stringify(error, null, 2)
                );

                Alert.alert(
                    "Password reset failed",
                    error.message ||
                    "We couldn't change your password."
                );

                return;
            }

            console.log(
                "PASSWORD RESET COMPLETE",
                signIn.status
            );

            if (signIn.status === "complete") {
                await signIn.finalize({
                    navigate: () => {
                        router.replace("/sign-in");
                    },
                });

                Alert.alert(
                    "Password changed",
                    "Your password has been changed. You can now sign in."
                );

                return;
            }

            Alert.alert(
                "Almost there",
                `Password reset is not complete yet. Status: ${signIn.status}`
            );
        } catch (error) {
            console.log(
                "RESET PASSWORD EXCEPTION:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Something went wrong",
                "Unable to change your password."
            );
        } finally {
            setSubmitting(false);
        }
    };

    // --------------------------------------------------
    // RESEND OTP
    // --------------------------------------------------

    const resendCode = async () => {
        try {
            setSubmitting(true);

            const { error } =
                await signIn.resetPasswordEmailCode.sendCode();

            if (error) {
                console.log(
                    "RESEND CODE ERROR:",
                    JSON.stringify(error, null, 2)
                );

                Alert.alert(
                    "Could not resend code",
                    error.message ||
                    "Please try again later."
                );

                return;
            }

            Alert.alert(
                "Code sent",
                "A new verification code has been sent to your email."
            );
        } catch (error) {
            console.log(
                "RESEND CODE EXCEPTION:",
                JSON.stringify(error, null, 2)
            );

            Alert.alert(
                "Something went wrong",
                "Unable to resend the code."
            );
        } finally {
            setSubmitting(false);
        }
    };

    // --------------------------------------------------
    // UI
    // --------------------------------------------------

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
                            {step === "email" &&
                                "Forgot password?"}

                            {step === "code" &&
                                "Check your email"}

                            {step === "password" &&
                                "Create new password"}
                        </Text>

                        <Text className="mt-2 text-center text-base text-slate-400">

                            {step === "email" &&
                                "We'll send you a verification code to reset your password."}

                            {step === "code" &&
                                `Enter the code we sent to ${email}`}

                            {step === "password" &&
                                "Choose a new password for your account."}

                        </Text>
                    </View>

                    {/* ================================= */}
                    {/* STEP 1 — EMAIL */}
                    {/* ================================= */}

                    {step === "email" && (
                        <>
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
                                className="mb-4 h-14 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-base text-white"
                            />

                            {errors.fields?.identifier && (
                                <Text className="mb-4 text-sm text-red-400">
                                    {errors.fields.identifier.message}
                                </Text>
                            )}

                            <Pressable
                                onPress={sendCode}
                                disabled={submitting || loading}
                                className={`h-14 items-center justify-center rounded-2xl bg-white ${submitting || loading
                                        ? "opacity-50"
                                        : ""
                                    }`}
                            >
                                <Text className="font-bold text-slate-950">
                                    {submitting || loading
                                        ? "Sending..."
                                        : "Send reset code"}
                                </Text>
                            </Pressable>
                        </>
                    )}

                    {/* ================================= */}
                    {/* STEP 2 — OTP */}
                    {/* ================================= */}

                    {step === "code" && (
                        <>
                            <Text className="mb-2 text-center text-sm font-medium text-slate-300">
                                Verification code
                            </Text>

                            <TextInput
                                value={code}
                                onChangeText={setCode}
                                placeholder="Enter 6-digit code"
                                placeholderTextColor="#64748b"
                                keyboardType="number-pad"
                                maxLength={6}
                                autoCapitalize="none"
                                className="mb-4 h-14 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-center text-lg tracking-widest text-white"
                            />

                            {errors.fields?.code && (
                                <Text className="mb-4 text-center text-sm text-red-400">
                                    {errors.fields.code.message}
                                </Text>
                            )}

                            <Pressable
                                onPress={verifyCode}
                                disabled={submitting || loading}
                                className={`h-14 items-center justify-center rounded-2xl bg-white ${submitting || loading
                                        ? "opacity-50"
                                        : ""
                                    }`}
                            >
                                <Text className="font-bold text-slate-950">
                                    {submitting || loading
                                        ? "Verifying..."
                                        : "Verify code"}
                                </Text>
                            </Pressable>

                            <Pressable
                                onPress={resendCode}
                                disabled={submitting || loading}
                                className="mt-5 items-center"
                            >
                                <Text className="text-sm font-medium text-slate-400">
                                    Resend code
                                </Text>
                            </Pressable>

                            <Pressable
                                onPress={() => {
                                    setStep("email");
                                    setCode("");
                                }}
                                className="mt-4 items-center"
                            >
                                <Text className="text-sm text-slate-500">
                                    Use a different email
                                </Text>
                            </Pressable>
                        </>
                    )}

                    {/* ================================= */}
                    {/* STEP 3 — NEW PASSWORD */}
                    {/* ================================= */}

                    {step === "password" && (
                        <>
                            <Text className="mb-2 ml-1 text-sm font-medium text-slate-300">
                                New password
                            </Text>

                            <TextInput
                                value={password}
                                onChangeText={setPassword}
                                placeholder="Enter new password"
                                placeholderTextColor="#64748b"
                                secureTextEntry
                                autoCapitalize="none"
                                className="mb-4 h-14 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-base text-white"
                            />

                            {errors.fields?.password && (
                                <Text className="mb-4 text-sm text-red-400">
                                    {errors.fields.password.message}
                                </Text>
                            )}

                            <Text className="mb-2 ml-1 text-sm font-medium text-slate-300">
                                Confirm password
                            </Text>

                            <TextInput
                                value={confirmPassword}
                                onChangeText={setConfirmPassword}
                                placeholder="Confirm new password"
                                placeholderTextColor="#64748b"
                                secureTextEntry
                                autoCapitalize="none"
                                className="mb-6 h-14 rounded-2xl border border-slate-800 bg-slate-900 px-4 text-base text-white"
                            />

                            <Pressable
                                onPress={resetPassword}
                                disabled={submitting || loading}
                                className={`h-14 items-center justify-center rounded-2xl bg-white ${submitting || loading
                                        ? "opacity-50"
                                        : ""
                                    }`}
                            >
                                <Text className="font-bold text-slate-950">
                                    {submitting || loading
                                        ? "Updating..."
                                        : "Set new password"}
                                </Text>
                            </Pressable>
                        </>
                    )}

                    {/* BACK TO SIGN IN */}

                    <View className="mt-8 flex-row justify-center">
                        <Text className="text-sm text-slate-500">
                            Remember your password?{" "}
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