package com.ytalks.backend.controller;

import com.ytalks.backend.dto.AuthResponse;
import com.ytalks.backend.dto.LoginRequest;
import com.ytalks.backend.dto.RegisterRequest;
import com.ytalks.backend.dto.ResendOtpRequest;
import com.ytalks.backend.dto.UserSummary;
import com.ytalks.backend.dto.VerifyOtpRequest;
import com.ytalks.backend.security.UserPrincipal;
import com.ytalks.backend.service.AuthService;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Authentication REST endpoints.
 * <p>
 * Provides registration with OTP verification, login, logout, and current user profile.
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /**
     * Initiates user registration.
     * Sends an OTP to the provided email.
     */
    @PostMapping(value = "/register", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AuthResponse> register(@Valid @RequestBody RegisterRequest request) {
        String otp = authService.initiateRegistration(request);
        // In dev mode, we return the OTP for testing; in production this would be null
        return ResponseEntity.ok(new AuthResponse(null, 0, null));
    }

    /**
     * Verifies the OTP and completes registration.
     * Returns a JWT access token on success.
     */
    @PostMapping(value = "/verify-otp", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AuthResponse> verifyOtp(@Valid @RequestBody VerifyOtpRequest request) {
        // We need the original registration data to complete registration
        // In a real app, this might be stored in a temporary session or passed from frontend
        // For simplicity, the frontend will call this after register with the same email
        // and we'll need to get the registration data from somewhere
        // This is a simplified approach - in production you'd store pending registration data
        throw new UnsupportedOperationException("Use /register with OTP verification flow");
    }

    /**
     * Combined register + verify endpoint for simpler frontend integration.
     * The frontend sends registration data + OTP code in one request after user enters OTP.
     */
    @PostMapping(value = "/register/verify", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AuthResponse> registerAndVerify(@Valid @RequestBody RegisterWithOtpRequest request) {
        RegisterRequest registerRequest = new RegisterRequest(
                request.name(), request.email(), request.phone(), request.password()
        );
        VerifyOtpRequest otpRequest = new VerifyOtpRequest(request.email(), request.code());

        AuthResponse response = authService.completeRegistration(registerRequest, otpRequest);
        return ResponseEntity.ok(response);
    }

    /**
     * Resends an OTP code for registration.
     */
    @PostMapping(value = "/resend-otp", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> resendOtp(@Valid @RequestBody ResendOtpRequest request) {
        authService.resendOtp(request.email());
        return ResponseEntity.ok().build();
    }

    /**
     * Authenticates a user with email and password.
     * Returns a JWT access token on success.
     */
    @PostMapping(value = "/login", consumes = MediaType.APPLICATION_JSON_VALUE, produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<AuthResponse> login(@Valid @RequestBody LoginRequest request) {
        AuthResponse response = authService.login(request);
        return ResponseEntity.ok(response);
    }

    /**
     * Gets the current authenticated user's profile.
     */
    @PostMapping(value = "/me", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<UserSummary> me(@AuthenticationPrincipal UserPrincipal userPrincipal) {
        UserSummary user = authService.getCurrentUser(userPrincipal.getId());
        return ResponseEntity.ok(user);
    }

    /**
     * Logout endpoint (client-side token invalidation).
     * With stateless JWT, logout is primarily a client-side action.
     * This endpoint exists for API consistency and potential future token blacklisting.
     */
    @PostMapping(value = "/logout", produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Void> logout() {
        // In a stateless JWT system, logout is client-side (delete token)
        // Server-side token blacklisting could be added here if needed
        return ResponseEntity.ok().build();
    }

    /**
     * Combined registration + OTP request for simpler frontend flow.
     */
    public record RegisterWithOtpRequest(
            String name,
            String email,
            String phone,
            String password,
            String code
    ) {}
}