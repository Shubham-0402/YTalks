package com.ytalks.backend.service;

import com.ytalks.backend.entity.User;
import com.ytalks.backend.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

/**
 * Service for user persistence operations.
 * <p>
 * Milestone 3 provides the data layer only. Authentication, registration
 * and password handling are deferred to Milestone 4.
 */
@Service
@Transactional(readOnly = true)
public class UserService {

    private final UserRepository userRepository;

    public UserService(UserRepository userRepository) {
        this.userRepository = userRepository;
    }

    /**
     * Finds a user by ID.
     */
    public Optional<User> findById(Long id) {
        return userRepository.findById(id);
    }

    /**
     * Finds a user by email (case-insensitive).
     */
    public Optional<User> findByEmail(String email) {
        return userRepository.findByEmailIgnoreCase(email);
    }

    /**
     * Checks if a user with the given email exists.
     */
    public boolean existsByEmail(String email) {
        return userRepository.existsByEmailIgnoreCase(email);
    }

    /**
     * Creates a new user.
     * <p>
     * The passwordHash is not set in this milestone; it exists only for
     * forward compatibility with Milestone 4.
     */
    @Transactional
    public User createUser(String name, String email, String phone) {
        if (userRepository.existsByEmailIgnoreCase(email)) {
            throw new IllegalArgumentException("User with email '" + email + "' already exists");
        }
        User user = new User();
        user.setName(name);
        user.setEmail(email);
        user.setPhone(phone);
        // passwordHash intentionally left null in Milestone 3
        return userRepository.save(user);
    }

    /**
     * Updates a user's profile information.
     */
    @Transactional
    public User updateUser(Long id, String name, String phone) {
        User user = userRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + id));
        if (name != null) user.setName(name);
        if (phone != null) user.setPhone(phone);
        return userRepository.save(user);
    }
}