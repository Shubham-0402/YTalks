package com.ytalks.backend.service;

import com.ytalks.backend.dto.AuthResponse;
import com.ytalks.backend.dto.LoginRequest;
import com.ytalks.backend.dto.RegisterRequest;
import com.ytalks.backend.dto.UserSummary;
import com.ytalks.backend.dto.VerifyOtpRequest;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.exception.AuthException;
import com.ytalks.backend.security.JwtService;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service coordinating the authentication flow.
 * <p>
 * Handles registration with OTP verification, login, and token generation.
 */
@Service
@Transactional
public class AuthService {

    private final UserService userService;
    private final OtpService otpService;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    public AuthService(UserService userService,
                       OtpService otpService,
                       JwtService jwtService,
                       AuthenticationManager authenticationManager) {
        this.userService = userService;
        this.otpService = otpService;
        this.jwtService = jwtService;
        this.authenticationManager = authenticationManager;
    }

    /**
     * Initiates registration by creating a pending user and sending an OTP.
     * The user is not fully created until OTP verification.
     *
     * @return the OTP code (only in dev mode; null in production)
     */
    public String initiateRegistration(RegisterRequest request) {
        // Check if user already exists
        if (userService.existsByEmail(request.email())) {
            throw AuthException.emailAlreadyExists();
        }

        // Generate and send OTP
        return otpService.generateAndStoreOtp(request.email());
    }

    /**
     * Completes registration after OTP verification.
     * Creates the user account with the provided password.
     */
    public AuthResponse completeRegistration(RegisterRequest request, VerifyOtpRequest otpRequest) {
        // Verify OTP
        if (!otpRequest.email().equalsIgnoreCase(request.email())) {
            throw AuthException.invalidOtp();
        }

        otpService.verifyOtp(request.email(), otpRequest.code());

        // Create user account
        User user = userService.createUser(
                request.name(),
                request.email(),
                request.phone(),
                request.password()
        );

        // Generate JWT token
        String token = jwtService.generateToken(user.getId());

        return new AuthResponse(
                token,
                jwtService.getExpirationMs(),
                toUserSummary(user)
        );
    }

    /**
     * Resends an OTP for registration.
     */
    public String resendOtp(String email) {
        if (!userService.existsByEmail(email)) {
            // Don't reveal whether email exists
            return otpService.generateAndStoreOtp(email);
        }
        throw AuthException.emailAlreadyExists();
    }

    /**
     * Authenticates a user with email and password.
     */
    public AuthResponse login(LoginRequest request) {
        // Authenticate using Spring Security
        try {
            authenticationManager.authenticate(
                    new UsernamePasswordAuthenticationToken(request.email(), request.password())
            );
        } catch (Exception e) {
            throw AuthException.invalidCredentials();
        }

        // Load user and generate token
        User user = userService.findByEmail(request.email())
                .orElseThrow(() -> AuthException.invalidCredentials());

        String token = jwtService.generateToken(user.getId());

        return new AuthResponse(
                token,
                jwtService.getExpirationMs(),
                toUserSummary(user)
        );
    }

    /**
     * Gets the current authenticated user's profile.
     */
    public UserSummary getCurrentUser(Long userId) {
        User user = userService.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
        return toUserSummary(user);
    }

    private UserSummary toUserSummary(User user) {
        return new UserSummary(
                user.getId(),
                user.getName(),
                user.getEmail(),
                user.getPhone(),
                user.getCreatedAt()
        );
    }
}