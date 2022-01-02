import subprocess
import json as jsn
import sys


FILE_PATH = sys.argv[1]
FILE_NAME = FILE_PATH.split('\\')[-1]
FILE_SIZE_LIMIT_IN_BYTES = 8388608 # 8 * 1024 * 1024

def resize_video():
    subprocess.run(f'.\\ffmpeg.exe -i "{FILE_PATH}" -s 1280x720 ".\\tmp\\{FILE_NAME + "_RESCALED.mp4"}"')
    #subprocess.run('.\\ffmpeg.exe -i "{FILE_PATH}"] [-s 1280x720] [".\\tmp\\{FILE_NAME + "_RESCALED.mp4"}"')


def split_video():
    subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{FILE_NAME + "_RESCALED.mp4"}" -c:v copy -an ".\\tmp\\{FILE_NAME + "_NO_AUD.mp4"}" -c:a copy -vn ".\\tmp\\{FILE_NAME + "_NO_VID.mp4"}"')


def merge_video(file_1, file_2, result_file):
    #subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{FILE_NAME + "_NO_AUD.mp4"}" -i ".\\tmp\\{FILE_NAME + "_NO_VID.mp4"}" -c copy ".\\tmp\\{FILE_NAME + "_MERGED.mp4"}"')
    subprocess.run(f'.\\ffmpeg.exe -i {file_1} -i {file_2} -c copy {result_file}')


def get_json_video_info_from_file():
    stdout = subprocess.run(f'.\\ffprobe.exe -i ".\\tmp\\{FILE_NAME + "_NO_AUD.mp4"}" -v quiet -print_format json -show_format -show_streams', capture_output=True, encoding='UTF-8').stdout
    info_json_video = jsn.loads(stdout)
    
    return info_json_video


def get_json_audio_info_from_file():
    stdout = stdout = subprocess.run(f'.\\ffprobe.exe -i ".\\tmp\\{FILE_NAME + "_NO_VID.mp4"}" -v quiet -print_format json -show_format -show_streams', capture_output=True, encoding='UTF-8').stdout
    info_json_audio = jsn.loads(stdout)

    return info_json_audio


def parse_json_info():
    json_video, json_audio = get_json_video_info_from_file(), get_json_audio_info_from_file()
    video_file_size_in_bytes = int(json_video['format']['size'])
    video_bitrate_in_bits = int(json_video['format']['bit_rate'])
    audio_file_size_in_bytes = int(json_audio['format']['size'])

    return video_file_size_in_bytes, video_bitrate_in_bits, audio_file_size_in_bytes


def determine_target_bitrate(video_file_size, audio_file_size, bitrate):
    div_coefficient = video_file_size / (FILE_SIZE_LIMIT_IN_BYTES - audio_file_size)
    target_bitrate_in_bits = bitrate / div_coefficient

    return target_bitrate_in_bits


def compress_file(bitrate, video_file_size, audio_file_size):
    if video_file_size + audio_file_size > FILE_SIZE_LIMIT_IN_BYTES:
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{FILE_NAME + "_NO_AUD.mp4"}" -b:v {bitrate} ".\\tmp\\{FILE_NAME + "_CHANGED_BITRATE.mp4"}"')
        merge_video(f'".\\tmp\\{FILE_NAME + "_CHANGED_BITRATE.mp4"}"', f'".\\tmp\\{FILE_NAME + "_NO_VID.mp4"}"', f'"{FILE_PATH + "_8MB.mp4"}"')
    else:
        subprocess.run(f'.\\ffmpeg.exe -i ".\\tmp\\{FILE_NAME + "_RESCALED.mp4"}" -c copy "{FILE_PATH + "_8MB.mp4"}"')


resize_video()
split_video()
video_file_size, video_bitrate, audio_file_size = parse_json_info()
bitrate = determine_target_bitrate(video_file_size, audio_file_size, video_bitrate)
compress_file(bitrate, video_file_size, audio_file_size)