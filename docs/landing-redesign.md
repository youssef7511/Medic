# Warm editorial landing page

The implementation follows `landing-page-prototypes/03-warm-editorial.png`:
ivory surfaces, navy serif headings, sage panels, teal actions and warm consultation
photography. The layout adapts for mobile and mirrors for Arabic.

Search submits a normal GET request to the existing localized doctor directory.
Specialty shortcuts use the same filters. Standard categories are shared with the
development seed; additional specialties and cities come from published profiles.
No sample physicians, reviews, availability or adoption numbers are inserted.
Doctor cards show published database profiles and use initials if no suitable
same-origin portrait is supplied. Existing profile, patient and doctor routes
remain responsible for authorization. Booking links retain the selected doctor
through the patient sign-in route.

The public catalog reads only public fields, at request time, so newly published
or unpublished profiles are reflected without rebuilding the site. Empty catalogs
keep search and the rest of the landing page usable. Header session state remains
client-resolved and never enters shared HTML.

The consultation image is illustrative, generated with the built-in imagegen tool.
It is optimized as `public/images/landing/consultation.webp` and shipped as a
same-origin static asset; it is not used as the portrait of a registered doctor.
The Docker runner copies `public` so the image is served in deployment.

## Image prompt

Generate a warm, photorealistic editorial consultation photograph for the Medic
hero, using prototype 03 as composition/style reference only. A friendly adult
Tunisian female doctor listens to an adult male patient in a sunlit ivory clinic.
Place the doctor toward the right third and the patient at the far right, leaving
the left half quiet for real HTML headings. Natural skin, hands, wood and sage
details; no text, interface, logos, watermark, diagnoses or readable documents.
Use invented subjects and a wide landscape composition.
