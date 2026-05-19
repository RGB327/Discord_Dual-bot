-- Discord Bot Database Schema
-- Database: Cards

CREATE DATABASE IF NOT EXISTS `Cards` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE `Cards`;

-- --------------------------------------------------------
-- 기본 테이블
-- --------------------------------------------------------

CREATE TABLE `users` (
  `user_id` varchar(50) NOT NULL,
  `cost` int DEFAULT '0',
  `username` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `cards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) DEFAULT NULL,
  `rarity` varchar(20) DEFAULT NULL,
  `attack` int DEFAULT NULL,
  `hp` int DEFAULT NULL,
  `comment` varchar(50) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `skill` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) DEFAULT NULL,
  `attack` float DEFAULT NULL,
  `skill` int DEFAULT NULL,
  `is_common` tinyint(1) DEFAULT NULL,
  `min` int DEFAULT NULL,
  `max` int DEFAULT NULL,
  `is_special` tinyint(1) DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `special_skill` (
  `skill_id` int NOT NULL AUTO_INCREMENT,
  `skill_name` varchar(50) DEFAULT NULL,
  `attack` int DEFAULT NULL,
  `min` int DEFAULT NULL,
  `max` int DEFAULT NULL,
  PRIMARY KEY (`skill_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `user_cards` (
  `user_id` varchar(50) NOT NULL,
  `card_id` int NOT NULL,
  `level` int DEFAULT '1',
  PRIMARY KEY (`user_id`,`card_id`),
  CONSTRAINT `user_cards_ibfk_1` FOREIGN KEY (`card_id`) REFERENCES `cards` (`id`),
  CONSTRAINT `user_cards_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `card_shop` (
  `id` int NOT NULL AUTO_INCREMENT,
  `card_id` int DEFAULT NULL,
  `price` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `card_shop_ibfk_1` FOREIGN KEY (`card_id`) REFERENCES `cards` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `card_skill` (
  `card_id` int NOT NULL,
  `skill_id` int NOT NULL,
  PRIMARY KEY (`card_id`,`skill_id`),
  CONSTRAINT `card_skill_ibfk_1` FOREIGN KEY (`card_id`) REFERENCES `cards` (`id`),
  CONSTRAINT `card_skill_ibfk_2` FOREIGN KEY (`skill_id`) REFERENCES `skill` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 배틀 테이블
-- --------------------------------------------------------

CREATE TABLE `match_queue` (
  `user_id` varchar(50) NOT NULL,
  `joined_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `match_queue_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `battles` (
  `id` int NOT NULL AUTO_INCREMENT,
  `player1_id` varchar(50) DEFAULT NULL,
  `player2_id` varchar(50) DEFAULT NULL,
  `turn_number` int DEFAULT '1',
  `turn_user_id` varchar(50) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'ongoing',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `player1_card_id` int DEFAULT NULL,
  `player2_card_id` int DEFAULT NULL,
  `battle_cost_p1` int DEFAULT '0',
  `battle_cost_p2` int DEFAULT '0',
  `winner_id` varchar(50) DEFAULT NULL,
  `p1_turn_ended` tinyint(1) DEFAULT '0',
  `p2_turn_ended` tinyint(1) DEFAULT '0',
  `p1_shop_closed` tinyint(1) DEFAULT '0',
  `p2_shop_closed` tinyint(1) DEFAULT '0',
  `p1_stunned` tinyint(1) DEFAULT '0',
  `p2_stunned` tinyint(1) DEFAULT '0',
  `p1_max_roll_debuff` int DEFAULT '0',
  `p2_max_roll_debuff` int DEFAULT '0',
  `p1_dmg_reduce` int DEFAULT '0',
  `p2_dmg_reduce` int DEFAULT '0',
  `p1_atk_buff` int DEFAULT '0',
  `p2_atk_buff` int DEFAULT '0',
  `p1_escape` tinyint(1) DEFAULT '0',
  `p2_escape` tinyint(1) DEFAULT '0',
  `p1_escape_card_id` int DEFAULT NULL,
  `p2_escape_card_id` int DEFAULT NULL,
  `p1_self_stun_next` tinyint(1) DEFAULT '0',
  `p2_self_stun_next` tinyint(1) DEFAULT '0',
  `p1_support_used` tinyint NOT NULL DEFAULT '0',
  `p2_support_used` tinyint NOT NULL DEFAULT '0',
  `p1_heal_next` int NOT NULL DEFAULT '0',
  `p2_heal_next` int NOT NULL DEFAULT '0',
  `p1_cc_clear_next` tinyint NOT NULL DEFAULT '0',
  `p2_cc_clear_next` tinyint NOT NULL DEFAULT '0',
  `p1_gon_survived` tinyint NOT NULL DEFAULT '0',
  `p2_gon_survived` tinyint NOT NULL DEFAULT '0',
  `p1_almangyi_skip` tinyint NOT NULL DEFAULT '0',
  `p2_almangyi_skip` tinyint NOT NULL DEFAULT '0',
  `p1_evolve_next` tinyint NOT NULL DEFAULT '0',
  `p2_evolve_next` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  CONSTRAINT `battles_ibfk_1` FOREIGN KEY (`player1_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `battles_ibfk_2` FOREIGN KEY (`player2_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `battles_ibfk_3` FOREIGN KEY (`winner_id`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `battle_cards` (
  `battle_id` int NOT NULL,
  `user_id` varchar(50) NOT NULL,
  `card_id` int DEFAULT NULL,
  `current_hp` int DEFAULT NULL,
  PRIMARY KEY (`battle_id`,`user_id`),
  CONSTRAINT `battle_cards_ibfk_1` FOREIGN KEY (`battle_id`) REFERENCES `battles` (`id`),
  CONSTRAINT `battle_cards_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`),
  CONSTRAINT `battle_cards_ibfk_3` FOREIGN KEY (`card_id`) REFERENCES `cards` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `battle_skills` (
  `id` int NOT NULL AUTO_INCREMENT,
  `battle_id` int DEFAULT NULL,
  `user_id` varchar(50) DEFAULT NULL,
  `skill_id` int DEFAULT NULL,
  `skill_slot` int DEFAULT NULL,
  `turn_selected` tinyint(1) DEFAULT '0',
  `is_special` tinyint(1) DEFAULT '0',
  `is_support` tinyint NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`),
  CONSTRAINT `battle_skills_ibfk_1` FOREIGN KEY (`battle_id`) REFERENCES `battles` (`id`),
  CONSTRAINT `battle_skills_ibfk_2` FOREIGN KEY (`skill_id`) REFERENCES `skill` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `battle_shop` (
  `id` int NOT NULL AUTO_INCREMENT,
  `battle_id` int NOT NULL,
  `user_id` varchar(50) NOT NULL,
  `item_type` varchar(20) NOT NULL,
  `item_id` int NOT NULL,
  `price` int NOT NULL,
  `is_sold` tinyint(1) DEFAULT '0',
  `turn` int NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `battle_shop_ibfk_1` FOREIGN KEY (`battle_id`) REFERENCES `battles` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE `battle_shop_price` (
  `id` int NOT NULL AUTO_INCREMENT,
  `item_type` varchar(20) NOT NULL,
  `item_id` int NOT NULL,
  `price` int NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item` (`item_type`,`item_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- --------------------------------------------------------
-- 기본 데이터
-- --------------------------------------------------------

INSERT INTO `cards` VALUES
(1,'봉구스','Admin',1000,3500,'코스 카르텔의 수반'),
(2,'망구스','탈주닌자',600,2000,'그의 탈주 실력은 세계 제일'),
(3,'전 준','원조 폐급',500,3000,'명실상부 원조 폐급'),
(4,'김 곤','샤코',1000,1650,'Why So Serious?'),
(5,'크류','크류',700,4000,'1대17의 전설을 세운 승리한 1의 사나이'),
(6,'알맹이','샌드백',300,5000,'1대17의 전설을 세운 17로 쳐발린 전설의 사나이'),
(7,'동탁','알맹이 전담일진',500,2500,'맹이를 패는 데 특화된 전술 동탁이'),
(8,'케이','방관자',700,2800,'I See You...'),
(9,'도비','데바데 악령',700,3000,'데바데의 악령, 언제나 납치를 준비하고 있다'),
(10,'못하요','더미데이터',1000,3270000,'그의 정체를 아는 사람은 아무도 없다'),
(23,'초절맹이','Admin',1250,2500,'최약체의 끝없는 의지가 만들어낸 최종 형태');

INSERT INTO `skill` VALUES
(1,'괜찮아 안죽어',1.4,1,1,1,9,0),
(2,'알맹이 내르지 마세요!',1.3,1,0,2,5,0),
(3,'인권 유린',1.5,1,0,3,7,0),
(4,'해치웠나?',1.6,1,1,2,7,0),
(5,'공동의 적',1.3,2,1,4,7,0),
(6,'선동',1.4,2,1,4,6,0),
(7,'던지기',1.5,2,0,5,6,0),
(8,'탈주',1.4,2,0,3,7,0),
(9,'ㅈㄴ 뛰어',0,2,0,5,8,0),
(10,'반동이다',1.6,2,0,3,6,0),
(11,'엿먹어라',1.2,3,1,6,9,0),
(12,'아무것도 듣고싶지 않아요..',2,3,1,7,12,0),
(13,'크류의 뜻대로',1.6,3,0,6,8,0),
(14,'아봉',1,3,0,4,7,0),
(15,'파이어펀치! 파이어펀치!',1.8,3,0,5,9,0),
(16,'안 아프게 처맞기',0,3,0,1,1,0),
(17,'아 매튜야 제발',1.8,3,0,7,8,0),
(18,'쥐도 새도 모르게',1.3,3,0,10,10,0),
(19,'나가 죽어라 그냥',2,3,0,4,7,0),
(20,'카르텔의 수장',1.5,3,0,7,12,0),
(21,'자 막아내라',2,0,0,10,12,1),
(22,'이것도 너프해 보시지',3,0,0,8,10,1),
(23,'전원, 처형이다!',1.5,0,0,9,13,1),
(27,'크류의 뜻대로 - 망',1,0,0,0,0,0),
(28,'크류의 뜻대로 - 곤',1,0,0,0,0,0),
(29,'크류의 뜻대로 - 봉',0.5,0,0,0,0,0),
(30,'수박빨리믂기',0,2,0,3,4,0),
(35,'삼연격',2,2,0,8,12,0),
(36,'초절맹이살격난참',5,3,0,12,20,0);

INSERT INTO `special_skill` VALUES
(1,'자 막아내라',3,12,15),
(2,'이것도 너프해 보시지',3,12,15),
(3,'전원, 처형이다!',3,13,13);

INSERT INTO `card_shop` VALUES
(1,1,10000),(2,2,5000),(3,3,2500),(4,4,2000),
(5,5,5500),(6,6,3000),(7,7,2500),(8,8,2000),(9,9,3500);

INSERT INTO `card_skill` VALUES
(6,2),(1,3),(4,3),(5,3),(7,3),(9,3),(3,7),(6,7),(2,8),(3,8),(8,8),
(1,9),(2,9),(8,9),(2,10),(4,10),(7,10),(9,10),(4,13),(1,14),(2,14),
(5,14),(7,15),(3,16),(6,16),(9,17),(2,18),(8,18),(5,19),(1,20),
(1,30),(23,35),(23,36);

INSERT INTO `battle_shop_price` VALUES
(1,'skill',1,50),(2,'skill',2,50),(3,'skill',3,50),(4,'skill',4,50),
(5,'skill',5,100),(6,'skill',6,100),(7,'skill',7,100),(8,'skill',8,100),
(9,'skill',9,100),(10,'skill',10,100),(11,'skill',11,150),(12,'skill',12,150),
(13,'skill',13,150),(14,'skill',14,150),(15,'skill',15,150),(16,'skill',16,150),
(17,'skill',17,150),(18,'skill',18,150),(19,'skill',19,150),(20,'skill',20,150),
(21,'skill',21,200),(22,'skill',22,200),(23,'skill',23,200);
