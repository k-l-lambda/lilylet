
Run MEI tests and generate gallery.

Steps:
1. Run `npx tsx tests/mei.ts`
2. Report the test results (total, passed, failed)
3. If any tests failed, list the failed test files
4. If there are new prefix type in test cases, append them into `tools/generateGallery.ts`.
5. Serve `tests/output/unit-cases` as a static file server.
