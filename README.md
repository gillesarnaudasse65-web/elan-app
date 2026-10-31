# Publication Élan web et Android 0.2.3

Cible : https://gillesarnaudasse65-web.github.io/elan-app/

Le dossier site/ contient 39 fichiers web et deux fichiers de distribution Android : downloads/elan-android-v0.2.3.apk et android-release.json. Seul site/ est publié, jamais les sources privées, bases de profils, exports personnels ou clés de signature.

Build complet SHA256 : abb10f560c00956225c87eaa756cbcfaf1e0158ac36e31e12ca44fcf318d1eae
Source privée SHA256 : abd912188d04396e2b5a8ff4e314d6c9bd5e591b2d8e1c2eb623facc9fb504a4
Commit de départ privé (pas celui de la cible publique) : 8d38021c22bebf3d4836e04389e22ce102c949d1
APK SHA256 : 3e74c48840d7e65baf1c4876c40cbbace4d75641146f527b5d72cfca9a6815cd
APK octets : 3875877

L’APK est ajouté après les builds Android et web ; il ne fait partie ni du précache ni des ressources PWA requises pour le hors ligne. Le même site sert le téléchargement, sans autre fournisseur ou API de publication. La validation de signature et les essais Android sont documentés séparément ; une vérification HTTP ne vaut pas installation sur un appareil.

Un push normal sur elan-publication déclenche le workflow de déploiement, déjà activé par le titulaire sur ce dépôt. Les actions officielles sont épinglées ; la garde Pages et les empreintes sont vérifiées avant upload. Aucun déploiement sur main, force-push ou changement du dépôt source privé n’est demandé.

Le rapport vérifie la racine et chacun des 41 fichiers (web, métadonnées et APK) par HTTPS, taille et SHA256. Il atteste séparément androidDownloadVerified et conserve les refus/échecs ; aucune réussite n’est annoncée avant verificationPassed:true. L’attestation est conservée sans force-push sur elan-publication-status.

L’application reste locale : les profils sont conservés sur chaque appareil/origine, sans compte ni synchronisation. Une nouvelle installation Android n’importe pas automatiquement les données du navigateur.
