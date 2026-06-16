from __future__ import annotations

import re


TEAM_TRANSLATIONS: dict[str, str] = {
    "Algeria": "阿尔及利亚",
    "Argentina": "阿根廷",
    "Australia": "澳大利亚",
    "Austria": "奥地利",
    "Belgium": "比利时",
    "Bosnia": "波黑",
    "Brazil": "巴西",
    "Canada": "加拿大",
    "Cape Verde": "佛得角",
    "Colombia": "哥伦比亚",
    "Congo DR": "刚果民主共和国",
    "Croatia": "克罗地亚",
    "Curacao": "库拉索",
    "Czech Republic": "捷克共和国",
    "Ecuador": "厄瓜多尔",
    "Egypt": "埃及",
    "England": "英格兰",
    "France": "法国",
    "Germany": "德国",
    "Ghana": "加纳",
    "Haiti": "海地",
    "Holland": "荷兰",
    "Iran": "伊朗",
    "Iraq": "伊拉克",
    "Ivory Coast": "科特迪瓦",
    "Japan": "日本",
    "Jordan": "约旦",
    "Korea Republic": "韩国",
    "Mexico": "墨西哥",
    "Morocco": "摩洛哥",
    "New Zealand": "新西兰",
    "Norway": "挪威",
    "O'Higgins": "奥希金斯",
    "Panama": "巴拿马",
    "Paraguay": "巴拉圭",
    "Portugal": "葡萄牙",
    "Qatar": "卡塔尔",
    "Scotland": "苏格兰",
    "Senegal": "塞内加尔",
    "South Africa": "南非",
    "Spain": "西班牙",
    "Sweden": "瑞典",
    "Switzerland": "瑞士",
    "Tunisia": "突尼斯",
    "Turkey": "土耳其",
    "USA": "美国",
    "Univ de Chile": "智利大学",
    "Uzbekistan": "乌兹别克斯坦",
}


def parse_match_teams(match_name: str) -> tuple[str, str]:
    parts = re.split(r"\s+(?:vs|v)\s+", match_name, maxsplit=1, flags=re.IGNORECASE)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()
    return match_name.strip(), ""


def translate_team(team_name: str) -> str:
    return TEAM_TRANSLATIONS.get(team_name.strip(), team_name.strip())


def translate_match_name(match_name: str) -> str:
    home, away = parse_match_teams(match_name)
    if away:
        return f"{translate_team(home)} 对 {translate_team(away)}"
    return translate_team(home)
