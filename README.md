# Paquet de publication Élan

Cette branche isolée contient uniquement les 28 fichiers de l’application dans site/, un manifeste SHA256 et le workflow natif de publication. Aucune donnée de profil, sauvegarde, documentation source ou ressource personnelle n’est incluse dans site/. Aucun package npm ni installation n’est nécessaire en CI.

Build SHA256 : c39dc0a6e3c250691f4b0a5f5a4022d1fe0b0c93df07ad1edae3efac2369999d
Sources locales SHA256 : a3a8cbea2b25926cccdf576bb710b7b6daa0cca9603a230d7fe20545dfc23605
Commit de départ du dépôt source privé Elan (absent de l’historique de la cible publique ; pas le commit des sources locales) : 8d38021c22bebf3d4836e04389e22ce102c949d1
Sous-chemin obligatoire : /elan-app/

Prérequis du titulaire : créer le dépôt public dédié puis activer Settings → Pages → Source : GitHub Actions avant le premier déploiement. Selon configure-pages v5, la création du site exige un jeton autre que GITHUB_TOKEN, avec administration:write et pages:write pour une GitHub App. Ce paquet ne demande aucun PAT ni secret supplémentaire ; le jeton automatique du workflow ne fournit pas ces droits. enablement:true ne garantit donc aucune activation et les échecs restent explicites.

Un push sur elan-publication déclenche configure-pages (activation éventuellement tentée avec les seuls droits disponibles), une garde sur le base_path réel /elan-app, upload de site/ puis deploy-pages. Aucune modification de main ni désactivation d’une ancienne configuration Pages n’est demandée. Les refus de permissions, de plan ou de politique Actions doivent rester visibles.

Après la tentative, le job report vérifie l’URL HTTPS rendue par deploy-pages, le vrai manifeste et chaque fichier attendu par taille et SHA256, avec de courts réessais. Le succès n’est attesté que si la page et tous les fichiers correspondent. Le rapport inclut le SHA réel du commit de publication exécuté (github.sha), le build, la configuration, le déploiement, les ressources et l’URL vérifiée.

L’attestation publication-status.json est persistée sur elan-publication-status par git normal sans force-push. Cette branche ne déclenche aucun déploiement. Un échec de vérification ou de persistance fait échouer le job ; ne pas annoncer l’URL comme fonctionnelle avant verificationPassed:true. L’adresse attendue https://gillesarnaudasse65-web.github.io/elan-app/ est une cible, pas une preuve de publication.

L’application reste une édition locale accompagnée : la disponibilité publique ne constitue pas une revue pédagogique, une validation phonétique ou une synchronisation de données. Les données restent sur l’appareil de chaque personne.
