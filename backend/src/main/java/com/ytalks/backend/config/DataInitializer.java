package com.ytalks.backend.config;

import com.ytalks.backend.entity.AiProvider;
import com.ytalks.backend.entity.Conversation;
import com.ytalks.backend.entity.Message;
import com.ytalks.backend.entity.SenderType;
import com.ytalks.backend.entity.User;
import com.ytalks.backend.service.AiProviderService;
import com.ytalks.backend.service.ConversationService;
import com.ytalks.backend.service.UserService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;
import java.time.Instant;
import java.util.List;

/**
 * Seeds the database with initial data on application startup.
 * <p>
 * This runs once when the application starts and ensures:
 * - Four AI providers exist
 * - Demo user exists with seeded conversations
 * It is idempotent — running multiple times does not create duplicates.
 */
@Configuration
public class DataInitializer {

    private static final Logger log = LoggerFactory.getLogger(DataInitializer.class);

    @Bean
    CommandLineRunner seedAiProviders(AiProviderService providerService) {
        return args -> {
            log.info("Seeding AI provider records...");

            providerService.ensureProvider("OpenAI", "openai", true);
            providerService.ensureProvider("Google Gemini", "gemini", true);
            providerService.ensureProvider("Anthropic Claude", "claude", true);
            providerService.ensureProvider("DeepSeek", "deepseek", true);

            long count = providerService.getAllProviders().size();
            log.info("AI provider seeding complete: {} provider(s) in database", count);
        };
    }

    @Bean
    CommandLineRunner seedDemoUser(UserService userService,
                                    ConversationService conversationService,
                                    AiProviderService providerService) {
        return args -> {
            log.info("Seeding demo user and conversations...");

            // Create or get demo user
            String demoEmail = "aarav.sharma@example.com";
            User demoUser = userService.findByEmail(demoEmail).orElseGet(() -> {
                log.info("Creating demo user...");
                return userService.createUser("Aarav Sharma", demoEmail, "+91 98765 43210", "Demo@12345");
            });

            // Get provider types for conversations (lowercase IDs that match frontend)
            String openaiType = "openai";
            String geminiType = "gemini";
            String claudeType = "claude";

            // Seed conversations if user has none
            if (conversationService.findByUser(demoUser).isEmpty()) {
                log.info("Seeding demo conversations for user: {}", demoUser.getEmail());
                seedDemoConversations(demoUser, conversationService, openaiType, geminiType, claudeType);
            } else {
                log.info("Demo user already has conversations, skipping seeding.");
            }
        };
    }

    private void seedDemoConversations(User user, ConversationService conversationService, 
                                      String openaiType, String geminiType, String claudeType) {
        Instant now = Instant.now();

        // Conversation 1: Java concurrency questions (Today - 25 min ago)
        Instant c1Created = now.minus(Duration.ofMinutes(25));
        Instant c1Updated = now.minus(Duration.ofMinutes(5));
        Conversation c1 = conversationService.createConversation(
                user, "Java concurrency questions", openaiType, "gpt-4.1-mini",
                c1Created, c1Updated);
        conversationService.addUserMessage(c1, "I am a 2nd year B.Tech student learning Java. Explain the difference between a thread and a process, and when I would actually need threads.", c1Created.plusSeconds(30));
        conversationService.addAssistantMessage(c1, "A **process** is its own program in memory with its own address space. A **thread** is a lightweight path of execution that shares that memory with other threads of the same process.\n\n- Threads are cheap to create, so you can have thousands.\n- Processes are isolated, so a crash in one does not kill the others.\n- Anything inside the same process can corrupt the same memory.", openaiType, "gpt-4.1-mini", c1Created.plusSeconds(90));
        conversationService.addUserMessage(c1, "Okay, so when would a beginner actually use threads instead of just writing normal code?", c1Created.plusSeconds(150));
        conversationService.addAssistantMessage(c1, "Good question — most of the time you would not. Threads become useful when one job is *slow* and you do not want the UI to freeze.\n\nPractical examples:\n\n- Reading a file while the user keeps typing.\n- Calling a slow web API and showing a spinner meanwhile.\n- Processing 500 rows one at a time.\n\nUntil then, keep your code single-threaded and easy to read. Reach for concurrency when you can point at a specific moment where waiting is visible to the user.", openaiType, "gpt-4.1-mini", c1Created.plusSeconds(210));
        conversationService.addUserMessage(c1, "That makes sense. Can you show me how ExecutorService is used with a Callable?", c1Created.plusSeconds(270));
        conversationService.addAssistantMessage(c1, "`ExecutorService` is the modern replacement for manually creating `Thread` objects.\n\n```java\nExecutorService pool = Executors.newFixedThreadPool(4);\nFuture<Integer> answer = pool.submit(() -> 6 * 7);\nSystem.out.println(answer.get());\npool.shutdown();\n```\n\n- `submit` takes a `Callable`, which may return a value and may throw a checked exception.\n- `Future.get()` blocks until the task finishes, and wraps failures in `ExecutionException`.\n- Always call `shutdown()` when you are done, otherwise the JVM will not exit.", openaiType, "gpt-4.1-mini", c1Created.plusSeconds(330));
        conversationService.addUserMessage(c1, "What is the difference between a Runnable and a Callable then?", c1Created.plusSeconds(390));
        conversationService.addAssistantMessage(c1, "Both are functional interfaces you can hand to an executor, but they differ in two ways.\n\n- `Runnable.run()` returns `void` and cannot throw checked exceptions.\n- `Callable.call()` returns a value and *can* throw a checked exception.\n\nIf you need an answer back, use `Callable`. If you only need the work done, use `Runnable`.", openaiType, "gpt-4.1-mini", c1Created.plusSeconds(450));

        // Conversation 2: Normalising a marks database (3 hours ago)
        Instant c2Created = now.minus(Duration.ofHours(3));
        Instant c2Updated = now.minus(Duration.ofHours(2).plusMinutes(17));
        Conversation c2 = conversationService.createConversation(
                user, "Normalising a marks database", geminiType, "gemini-2.5-flash",
                c2Created, c2Updated);
        conversationService.addUserMessage(c2, "I need to store student marks for a college project. Should I make one table with everything?", c2Created.plusSeconds(30));
        conversationService.addAssistantMessage(c2, "You *can*, but it will hurt quickly. The usual problem is repeating the same student and subject details on every row.\n\nA cleaner shape:\n\n- `students` — one row per student\n- `subjects` — one row per subject\n- `enrollments` — who is taking what\n- `marks` — one row per student, per subject\n\nEach table then has a single clear responsibility, and updating a student name touches exactly one row.", geminiType, "gemini-2.5-flash", c2Created.plusSeconds(90));
        conversationService.addUserMessage(c2, "How do I make sure the same subject is not inserted twice?", c2Created.plusSeconds(150));
        conversationService.addAssistantMessage(c2, "Use a **unique constraint** rather than checking in code, because the database is the only place that can guarantee it under concurrency.\n\n- Primary key on `id` for identity.\n- A unique key on `(code)` in `subjects` so `CS101` can exist only once.\n\nIn JPA you can express it with `@Table(uniqueConstraints = ...)`, and Hibernate will turn it into a real `UNIQUE` index in MySQL.", geminiType, "gemini-2.5-flash", c2Created.plusSeconds(210));
        conversationService.addUserMessage(c2, "That is exactly what I needed. One more thing — should I store the grade as a letter or as a number?", c2Created.plusSeconds(270));
        conversationService.addAssistantMessage(c2, "Store the number. Letters are a *presentation* decision that changes between semesters, universities and even subjects.\n\nKeep `marks_obtained` and `marks_max` as decimals, compute the percentage or grade in a service, and let the front end decide how to display it. If you must cache the letter too, make it a derived column you can safely recompute.", geminiType, "gemini-2.5-flash", c2Created.plusSeconds(330));

        // Conversation 3: CV bullet points for AI internship (1 day ago)
        Instant c3Created = now.minus(Duration.ofDays(1));
        Instant c3Updated = now.minus(Duration.ofDays(1).plusMinutes(11));
        Conversation c3 = conversationService.createConversation(
                user, "CV bullet points for AI internship", claudeType, "claude-sonnet-4-5",
                c3Created, c3Updated);
        conversationService.addUserMessage(c3, "Rewrite these CV bullets so they sound less generic: \"Made a website using Java and MySQL\".", c3Created.plusSeconds(30));
        conversationService.addAssistantMessage(c3, "The problem is not the technology, it is that there is no *outcome*. Compare:\n\n- Before: \"Made a website using Java and MySQL.\"\n- After: \"Built a Spring Boot + MySQL student records app with role-based login, reducing manual register entry to a single search.\"\n\nThree things every strong bullet contains:\n\n- What you built\n- The scale or constraint you handled\n- The measurable result", claudeType, "claude-sonnet-4-5", c3Created.plusSeconds(90));
        conversationService.addUserMessage(c3, "I do not have real numbers yet because it is a college project. Is that a problem?", c3Created.plusSeconds(150));
        conversationService.addAssistantMessage(c3, "Not really, but you can substitute honest scale for business metrics.\n\n- \"Handles 5,000+ rows\" instead of \"scales to millions\".\n- \"Reduces a 3-step manual process to 1 search.\"\n- \"Cuts report preparation from 40 minutes to under 2.\"\n\nEven better, run a quick benchmark on your own dataset and quote the real number. Interviewers trust measured figures far more than round ones.", claudeType, "claude-sonnet-4-5", c3Created.plusSeconds(210));

        // Conversation 4: Explaining Dijkstra (cross-AI demo) (2 days ago)
        Instant c4Created = now.minus(Duration.ofDays(2));
        Instant c4Updated = now.minus(Duration.ofDays(2).plusMinutes(12));
        Conversation c4 = conversationService.createConversation(
                user, "Explaining Dijkstra (cross-AI demo)", geminiType, "gemini-2.5-flash",
                c4Created, c4Updated);
        conversationService.addUserMessage(c4, "Explain Dijkstra shortest path to me as if I have never heard of graphs.", c4Created.plusSeconds(30));
        conversationService.addAssistantMessage(c4, "Imagine a city map where every road has a travel time. Dijkstra finds the fastest route from A to B.\n\nThe one idea that makes it click: at every step, commit to the closest unvisited node. You never have to come back to it, because any later path would be longer.\n\n- Put the start node in a priority queue with distance 0.\n- Repeatedly pop the smallest distance, relax its neighbours.\n- Mark it visited and move on.", geminiType, "gemini-2.5-flash", c4Created.plusSeconds(90));
        conversationService.addUserMessage(c4, "What if the roads have different weights in each direction?", c4Created.plusSeconds(150));
        conversationService.addAssistantMessage(c4, "Then it is a directed weighted graph, and Dijkstra still works as long as every weight is non-negative.\n\nIf any road can be *negative* — think of a rebate or a discount edge — Dijkstra is no longer correct, because it commits too early. In that case you want Bellman-Ford, or A* with an admissible heuristic.", geminiType, "gemini-2.5-flash", c4Created.plusSeconds(210));
        // Add handoff message
        conversationService.addSystemMessage(c4, "Context transferred from OpenAI → Google Gemini, 4 messages transferred", c4Updated);

        // Conversation 5: Fixing a bad git rebase (5 days ago)
        Instant c5Created = now.minus(Duration.ofDays(5));
        Instant c5Updated = now.minus(Duration.ofDays(5).plusMinutes(15));
        Conversation c5 = conversationService.createConversation(
                user, "Fixing a bad git rebase", openaiType, "gpt-4.1-mini",
                c5Created, c5Updated);
        conversationService.addUserMessage(c5, "I ran git rebase and now my branch has 40 commits and I cannot find my code. How do I undo?", c5Created.plusSeconds(30));
        conversationService.addAssistantMessage(c5, "Nothing is lost — rebase keeps the old commits in the reflog for about 90 days.\n\n- `git reflog` shows every position your HEAD has held.\n- Find the entry just before the rebase started.\n- `git reset --hard <that-sha>` puts the branch back.\n\nThen fix the cause before retrying: commit more often, and run `git pull --rebase` regularly so you never fall thousands of commits behind.", openaiType, "gpt-4.1-mini", c5Created.plusSeconds(90));
        conversationService.addUserMessage(c5, "Found it, thank you. Is there a way to stop this happening again?", c5Created.plusSeconds(150));
        conversationService.addAssistantMessage(c5, "Yes — three habits cover almost every case.\n\n- Rebase your own unpushed work freely; never rebase a shared branch.\n- `git config --global pull.rebase true` so pulls stay linear.\n- Run `git status` before any history-changing command and read what it says.", openaiType, "gpt-4.1-mini", c5Created.plusSeconds(210));

        log.info("Demo conversations seeded successfully for user: {}", user.getEmail());
    }
}